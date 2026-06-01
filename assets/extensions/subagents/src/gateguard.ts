import path from "node:path";

// ── Existing GateGuard (first-edit investigation) ──────────────────────────

export interface GateGuardEntry {
  path: string;
  blocked: boolean;
  approved: boolean;
  blockedAt: number;
  approvedAt: number | null;
}

const STATE = new Map<string, GateGuardEntry>();
const INVESTIGATION_PROMPT = "\n[GateGuard] This is the first edit to this file. Before making changes, investigate:\n- What imports/schemas does this file use?\n- What existing code depends on this file?\n- Is this the right approach, or is there a simpler way?\nState your findings, then the edit will proceed.\n";

export class GateGuard {
  check(filePath: string): { blocked: boolean; message?: string } {
    const normalized = filePath.replace(/\/+/g, "/").replace(/\/$/, "");
    const existing = STATE.get(normalized);

    if (!existing) {
      STATE.set(normalized, {
        path: normalized,
        blocked: true,
        approved: false,
        blockedAt: Date.now(),
        approvedAt: null,
      });
      return { blocked: true, message: INVESTIGATION_PROMPT };
    }

    if (existing.blocked && !existing.approved) {
      return { blocked: true, message: INVESTIGATION_PROMPT };
    }

    return { blocked: false };
  }

  approve(filePath: string): void {
    const normalized = filePath.replace(/\/+/g, "/").replace(/\/$/, "");
    const entry = STATE.get(normalized);
    if (entry) {
      entry.blocked = false;
      entry.approved = true;
      entry.approvedAt = Date.now();
    }
  }

  reset(filePath?: string): void {
    if (filePath) {
      const normalized = filePath.replace(/\/+/g, "/").replace(/\/$/, "");
      STATE.delete(normalized);
    } else {
      STATE.clear();
    }
  }

  getStats(): { total: number; blocked: number; approved: number } {
    let blocked = 0;
    let approved = 0;
    for (const entry of STATE.values()) {
      if (entry.blocked) blocked++;
      if (entry.approved) approved++;
    }
    return { total: STATE.size, blocked, approved };
  }
}

export const gateguard = new GateGuard();

// ── Policy-as-Code Engine ──────────────────────────────────────────────────

export interface ActionRequest {
  type: "run_command" | "read_file" | "write_file" | "edit_file" | "delete_file" | "network" | "unknown";
  command?: string;
  args?: string[];
  path?: string;
  workdir?: string;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  violation?: "filesystem" | "command" | "network" | "unknown";
}

export class PolicyViolationError extends Error {
  constructor(
    public readonly violation: string,
    public readonly action: ActionRequest,
    public readonly reason: string
  ) {
    super(`PolicyViolation: ${reason}`);
    this.name = "PolicyViolationError";
  }
}

const ALLOWED_COMMANDS = new Set([
  "git", "node", "npm", "npx", "python", "python3", "pip", "pip3",
  "ls", "cat", "head", "tail", "echo", "mkdir", "cp", "mv", "rm",
  "touch", "chmod", "grep", "find", "sort", "wc", "diff", "patch",
  "curl", "wget", "tar", "gzip", "gunzip", "unzip", "zip",
  "docker", "docker-compose",
  "make", "cmake", "gcc", "g++", "clang", "rustc", "cargo",
  "tsc", "eslint", "prettier", "jest", "mocha", "vitest",
  "kill", "ps", "top", "df", "du", "env", "which",
  "gh", "ssh", "scp", "rsync",
]);

const DENIED_COMMANDS = new Set([
  "sudo", "su", "chown", "dd", "mkfs", "fdisk", "mount",
  "passwd", "useradd", "usermod", "groupadd",
  "iptables", "ufw", "systemctl", "service",
  "shutdown", "reboot", "halt", "poweroff",
  "crontab", "at",
]);

const PROJECT_ROOT = process.env.PI_PROJECT_ROOT || process.cwd();

export class PolicyValidator {
  private allowedCommands: Set<string>;
  private deniedCommands: Set<string>;
  private projectRoot: string;

  constructor(opts?: { allowedCommands?: Set<string>; deniedCommands?: Set<string>; projectRoot?: string }) {
    this.allowedCommands = opts?.allowedCommands ?? new Set(ALLOWED_COMMANDS);
    this.deniedCommands = opts?.deniedCommands ?? new Set(DENIED_COMMANDS);
    this.projectRoot = opts?.projectRoot ?? PROJECT_ROOT;
  }

  validate(action: ActionRequest): PolicyResult {
    switch (action.type) {
      case "run_command":
        return this.validateCommand(action);
      case "read_file":
      case "write_file":
      case "edit_file":
      case "delete_file":
        return this.validatePath(action);
      case "network":
        return this.validateNetwork(action);
      default:
        return { allowed: true };
    }
  }

  private validateCommand(action: ActionRequest): PolicyResult {
    const cmd = action.command || "";
    const base = cmd.split(/\s+/)[0];

    if (this.deniedCommands.has(base)) {
      return {
        allowed: false,
        reason: `Command '${base}' is denied for security reasons`,
        violation: "command",
      };
    }

    if (cmd.includes("bash -c") || cmd.includes("sh -c") || cmd.includes("zsh -c")) {
      return {
        allowed: false,
        reason: `Inline shell execution ('${base} -c') is blocked — use explicit commands instead`,
        violation: "command",
      };
    }

    if (this.allowedCommands.size > 0 && !this.allowedCommands.has(base)) {
      return {
        allowed: false,
        reason: `Command '${base}' is not in the allowed list`,
        violation: "command",
      };
    }

    if (cmd.includes("|") && cmd.split("|").length > 2) {
      return {
        allowed: false,
        reason: "Chained pipes (more than 1) are not permitted",
        violation: "command",
      };
    }

    return { allowed: true };
  }

  private validatePath(action: ActionRequest): PolicyResult {
    const filePath = action.path || "";
    const workdir = action.workdir || process.cwd();

    if (filePath.includes("..")) {
      return {
        allowed: false,
        reason: `Path contains '..' traversal: '${filePath}'`,
        violation: "filesystem",
      };
    }

    const absPath = path.resolve(workdir, filePath);
    const root = path.resolve(this.projectRoot);

    if (!absPath.startsWith(root)) {
      return {
        allowed: false,
        reason: `Path '${absPath}' is outside project root '${root}'`,
        violation: "filesystem",
      };
    }

    return { allowed: true };
  }

  private validateNetwork(action: ActionRequest): PolicyResult {
    return { allowed: true };
  }
}

export const policyValidator = new PolicyValidator();
