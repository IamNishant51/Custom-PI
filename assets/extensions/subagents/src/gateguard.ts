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
