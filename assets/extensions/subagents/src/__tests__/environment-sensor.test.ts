import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { EnvironmentSensor } from "../perception/environment-sensor";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => {
  const mod = {
    execSync: mockExecSync,
    spawnSync: mockSpawnSync,
    exec: vi.fn(),
    spawn: vi.fn(),
    fork: vi.fn(),
  };
  return { ...mod, default: mod };
});

describe("EnvironmentSensor", () => {
  let sensor: EnvironmentSensor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnSync.mockReturnValue({ status: 0 });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith("df ")) return "/dev/sda1 100G 50G 50G 50% /\n";
      if (cmd.startsWith("pgrep ")) return "";
      if (cmd.startsWith("ps ")) return "100\n";
      return "";
    });
    sensor = new EnvironmentSensor();
  });

  it("has environment state fields", () => {
    const env = sensor.getEnvironment();
    expect(env).toHaveProperty("hostname");
    expect(env).toHaveProperty("platform");
    expect(env).toHaveProperty("arch");
    expect(env).toHaveProperty("cpuUsage");
    expect(env).toHaveProperty("memoryUsagePercent");
    expect(env).toHaveProperty("diskUsagePercent");
    expect(env).toHaveProperty("processes");
    expect(env).toHaveProperty("networkInterfaces");
    expect(env).toHaveProperty("isLinux");
    expect(env).toHaveProperty("hasDocker");
    expect(env).toHaveProperty("hasGit");
    expect(env).toHaveProperty("hasNode");
    expect(typeof env.hostname).toBe("string");
    expect(typeof env.cpuUsage).toBe("number");
    expect(typeof env.memoryUsagePercent).toBe("number");
  });

  it("git state returns expected shape", () => {
    // Use project root which is a git repo
    const projectRoot = process.cwd();
    const state = sensor.getGitState(projectRoot);
    expect(state).not.toBeNull();
    expect(typeof state!.branch).toBe("string");
    expect(typeof state!.dirty).toBe("boolean");
    expect(typeof state!.lastCommit).toBe("string");
    expect(state).toHaveProperty("ahead");
    expect(state).toHaveProperty("behind");
  });

  it("file watching detects changes", async () => {
    const testDir = fs.mkdtempSync("/tmp/pi-env-test-");
    try {
      sensor.watchDirectory(testDir);
      fs.writeFileSync(`${testDir}/test.txt`, "hello");
      await new Promise(r => setTimeout(r, 300));
      const changes = sensor.getRecentChanges();
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some(c => c.path.includes("test.txt"))).toBe(true);
    } finally {
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("network availability returns correct shape", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await sensor.checkNetworkAvailability();
    expect(result).toHaveProperty("lmStudio");
    expect(result).toHaveProperty("ollama");
    expect(result).toHaveProperty("apiEndpoints");
    expect(typeof result.lmStudio).toBe("boolean");
    expect(typeof result.ollama).toBe("boolean");
    expect(typeof result.apiEndpoints).toBe("object");
  });

  it("IDE detection returns correct shape", () => {
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation((p: unknown) => {
      if (p === "/proc") return ["100", "200"] as any;
      return [];
    });
    const readFileSpy = vi.spyOn(fs, "readFileSync").mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === "/proc/100/cmdline") return "code\0--ms-enable-electron-run-as-node\0/src/main.ts\0";
      if (s === "/proc/200/cmdline") return "nvim\0README.md\0";
      return "";
    });

    const ide = sensor.detectIDE();
    expect(ide).toHaveProperty("vscode");
    expect(ide).toHaveProperty("neovim");
    expect(ide).toHaveProperty("activeFiles");
    expect(typeof ide.vscode).toBe("boolean");
    expect(typeof ide.neovim).toBe("boolean");

    readdirSpy.mockRestore();
    readFileSpy.mockRestore();
  });

  it("process health check returns correct shape", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("pgrep -x node")) return "123\n";
      if (cmd.includes("pgrep -x tsx")) return "";
      if (cmd.includes("pgrep -x ts-node")) return "";
      if (cmd.includes("pgrep -f mcp-server")) return "456\n";
      if (cmd.includes("pgrep -f mcp-proxy")) return "";
      if (cmd.includes("pgrep -f mcp-gateway")) return "";
      if (cmd.includes("pgrep -f email")) return "789\n";
      if (cmd.includes("pgrep -f social")) return "";
      return "";
    });

    const health = sensor.checkSubProcessHealth();
    expect(health).toHaveProperty("subAgents");
    expect(health).toHaveProperty("mcpServers");
    expect(health).toHaveProperty("bridges");
    expect(health).toHaveProperty("status");
    expect(["healthy", "degraded", "unhealthy"]).toContain(health.status);
    expect(health.subAgents).toHaveProperty("running");
    expect(health.subAgents).toHaveProperty("total");
    expect(health.subAgents).toHaveProperty("names");
    expect(Array.isArray(health.mcpServers)).toBe(true);
    expect(typeof health.bridges.email).toBe("boolean");
    expect(typeof health.bridges.social).toBe("boolean");
  });

  it("resource pressure status", () => {
    const pressure = sensor.getResourcePressure();
    expect(["low", "moderate", "high", "critical"]).toContain(pressure);
  });

  it("disk usage caching", () => {
    const first = sensor.getDiskUsage("/tmp");
    expect(first).toHaveProperty("totalGb");
    expect(first).toHaveProperty("freeGb");
    expect(first).toHaveProperty("usedPercent");

    mockExecSync.mockClear();
    const second = sensor.getDiskUsage("/tmp");
    expect(mockExecSync).not.toHaveBeenCalled();
    expect(second.totalGb).toBe(first.totalGb);
    expect(second.freeGb).toBe(first.freeGb);
    expect(second.usedPercent).toBe(first.usedPercent);
  });
});
