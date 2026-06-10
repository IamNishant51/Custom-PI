import { completeSimple } from "@earendil-works/pi-ai";
import { readMemoryRaw, memoryWrite, loadMemorySnapshot } from "./memory-file-store";

const COMBINED_REVIEW_PROMPT = `You are a context-review system for an AI coding agent.
Your role is to analyze the conversation and extract durable facts, user preferences, project decisions, and useful skills.

Recent conversation:
{conversation}

Current memory contents (MEMORY.md):
{memory_content}

Current user profile (USER.md):
{user_content}

Analyze the conversation and produce a concise update. Follow these rules:
1. Extract any new durable facts about the user, their preferences, or their project.
2. Identify any outdated or contradicted entries.
3. Suggest new skill patterns if you notice repeated operations.
4. Keep everything concise — each entry should be a single line starting with "- ".

Output format:
MEMORY_UPDATE:
- <fact about project/system/integrations>

USER_UPDATE:
- <fact about user preference or style>

OBSOLETE:
- <old fact that is contradicted>

If no updates needed, output: NO_UPDATE`;

export interface ReviewResult {
  memoryAdded: string[];
  userAdded: string[];
  obsolete: string[];
  summary: string;
}

export interface AuthInfo {
  apiKey?: string;
  headers?: Record<string, string>;
}

function parseReviewOutput(output: string): ReviewResult {
  const result: ReviewResult = { memoryAdded: [], userAdded: [], obsolete: [], summary: "" };
  let section: "memory" | "user" | "obsolete" | null = null;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("MEMORY_UPDATE:") || trimmed.startsWith("memory_update:")) {
      section = "memory"; continue;
    }
    if (trimmed.startsWith("USER_UPDATE:") || trimmed.startsWith("user_update:")) {
      section = "user"; continue;
    }
    if (trimmed.startsWith("OBSOLETE:")) {
      section = "obsolete"; continue;
    }
    if (trimmed === "NO_UPDATE") break;
    if (section && trimmed.startsWith("- ")) {
      const entry = trimmed.slice(2).trim();
      if (entry) {
        if (section === "memory") result.memoryAdded.push(entry);
        else if (section === "user") result.userAdded.push(entry);
        else if (section === "obsolete") result.obsolete.push(entry);
      }
    }
    if (!section && trimmed.startsWith("- ")) {
      result.memoryAdded.push(trimmed.slice(2).trim());
    }
  }
  result.summary = `memory: +${result.memoryAdded.length}, user: +${result.userAdded.length}, obsolete: ${result.obsolete.length}`;
  return result;
}

// Minimal type for completeSimple model parameter
type ReviewModel = Parameters<typeof completeSimple>[0];

async function callSimple(
  model: ReviewModel,
  auth: AuthInfo,
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  const response = await completeSimple(model, {
    systemPrompt,
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
  });
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map(c => c.text)
    .join("\n");
}

export async function runMemoryReview(
  model: ReviewModel,
  auth: AuthInfo,
  conversation: string,
): Promise<ReviewResult> {
  const snapshot = loadMemorySnapshot();
  const truncatedConversation = conversation.length > 8000 ? conversation.slice(-8000) : conversation;
  const prompt = COMBINED_REVIEW_PROMPT
    .replace("{conversation}", truncatedConversation || "(no conversation)")
    .replace("{memory_content}", snapshot.memory || "(empty)")
    .replace("{user_content}", snapshot.user || "(empty)");

  try {
    const response = await callSimple(
      model,
      auth,
      prompt,
      "You are a precise memory curation system. Only extract truly durable facts.",
    );
    const result = parseReviewOutput(response);
    for (const entry of result.memoryAdded) {
      memoryWrite("add", "memory", entry);
    }
    for (const entry of result.userAdded) {
      memoryWrite("add", "user", entry);
    }
    for (const entry of result.obsolete) {
      memoryWrite("remove", "memory", "", entry);
      memoryWrite("remove", "user", "", entry);
    }
    return result;
  } catch (err) {
    return { memoryAdded: [], userAdded: [], obsolete: [], summary: `Review failed: ${err}` };
  }
}

export async function runSkillReview(
  model: ReviewModel,
  auth: AuthInfo,
  conversation: string,
): Promise<ReviewResult> {
  const prompt = `Review the conversation for repeated operation patterns that could be extracted as a skill.
A skill is a reusable procedure for a complex multi-step operation.

List any suggested new skills as:
- <skill_name>: <description>

If no skills needed: NO_UPDATE`;

  try {
    const response = await callSimple(
      model,
      auth,
      prompt,
      "You are a skill-extraction system.",
    );
    const lines = response.split("\n").filter(l => l.trim().startsWith("- ")).map(l => l.trim().slice(2).trim());
    return { memoryAdded: [], userAdded: [], obsolete: [], summary: `suggested ${lines.length} skills` };
  } catch {
    return { memoryAdded: [], userAdded: [], obsolete: [], summary: "Skill review failed" };
  }
}

export async function runPreCompressionFlush(
  model: ReviewModel,
  auth: AuthInfo,
  conversation: string,
): Promise<void> {
  await runMemoryReview(model, auth, conversation);
}
