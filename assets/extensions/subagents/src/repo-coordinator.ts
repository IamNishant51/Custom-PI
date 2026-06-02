import { execFileSync } from "node:child_process";

function sanitizeGitRef(input: string): string {
  return input.replace(/[^a-zA-Z0-9_\-.\/]/g, "");
}

export interface RepoState {
  owner: string;
  repo: string;
  branch: string;
  sha?: string;
  hasOpenPr?: boolean;
  prUrl?: string;
  stableTag?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: "build" | "runtime" | "dev";
}

export interface MultiRepoChange {
  repo: string;
  branch: string;
  baseBranch: string;
  files: { path: string; content: string }[];
  commitMessage: string;
}

export function checkRepoState(owner: string, repo: string, branch: string, ghToken?: string): RepoState {
  const safeOwner = sanitizeGitRef(owner);
  const safeRepo = sanitizeGitRef(repo);
  const safeBranch = sanitizeGitRef(branch);
  const token = ghToken || process.env.GITHUB_TOKEN || "";
  try {
    const sha = execFileSync("git", ["ls-remote", `https://github.com/${safeOwner}/${safeRepo}.git`, safeBranch], {
      encoding: "utf8", timeout: 15000,
    }).split(/\s+/)[0] || "";

    const curlArgs = ["-s"];
    if (token) curlArgs.push("-H", `Authorization: token ${token}`);
    curlArgs.push(`https://api.github.com/repos/${safeOwner}/${safeRepo}/pulls?state=open&head=${safeBranch}`);

    const prsRaw = execFileSync("curl", curlArgs, { encoding: "utf8", timeout: 15000 });
    const prs = JSON.parse(prsRaw);
    const hasOpenPr = Array.isArray(prs) && prs.length > 0;

    return {
      owner, repo, branch, sha,
      hasOpenPr,
      prUrl: hasOpenPr ? prs[0]?.html_url : undefined,
    };
  } catch {
    return { owner, repo, branch, hasOpenPr: false };
  }
}

export function identifyDependencyOrder(repos: RepoState[], edges: DependencyEdge[]): string[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const r of repos) {
    const key = `${r.owner}/${r.repo}`;
    if (!graph.has(key)) graph.set(key, []);
    if (!inDegree.has(key)) inDegree.set(key, 0);
  }

  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!graph.has(from)) graph.set(from, []);
    if (!inDegree.has(to)) inDegree.set(to, 0);
    graph.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [key, deg] of inDegree) {
    if (deg === 0) queue.push(key);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const dep of graph.get(node) || []) {
      const newDeg = (inDegree.get(dep) || 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  return order;
}

export function planMultiRepoCommit(changes: MultiRepoChange[], edges: DependencyEdge[]): MultiRepoChange[][] {
  const repos = changes.map(c => ({ owner: c.repo.split("/")[0], repo: c.repo.split("/")[1] || c.repo, branch: c.branch }));
  const order = identifyDependencyOrder(
    repos.map(r => ({ ...r, hasOpenPr: false })),
    edges,
  );

  const batches: MultiRepoChange[][] = [];
  const used = new Set<string>();

  for (const repoKey of order) {
    const batch = changes.filter(c => `${c.repo}` === repoKey && !used.has(c.repo));
    for (const c of batch) used.add(c.repo);
    if (batch.length > 0) batches.push(batch);
  }

  // Add remaining (unlisted) repos
  const remaining = changes.filter(c => !used.has(c.repo));
  if (remaining.length > 0) batches.push(remaining);

  return batches;
}
