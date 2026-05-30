import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LocalStorageDriver } from "../storage-driver";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("LocalStorageDriver", () => {
  const testDir = path.join(os.tmpdir(), `pi-test-driver-${Date.now()}`);
  let driver: LocalStorageDriver;

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    driver = new LocalStorageDriver(testDir);
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("should write and read files correctly within the workspace", async () => {
    const file = "subdir/test.txt";
    const data = "hello storage driver";

    await driver.writeFile(file, data);
    
    const read = await driver.readFile(file);
    expect(read).toBe(data);
  });

  it("should list directories correctly", async () => {
    await driver.writeFile("subdir/file1.txt", "1");
    await driver.writeFile("subdir/file2.txt", "2");

    const entries = await driver.listDirectory("subdir");
    expect(entries.length).toBe(3); // test.txt, file1.txt, file2.txt

    const f1 = entries.find(e => e.name === "file1.txt");
    expect(f1).toBeDefined();
    expect(f1?.isDir).toBe(false);
  });

  it("should block path traversals outside the workspace", async () => {
    await expect(driver.readFile("../outside.txt")).rejects.toThrow("Path traversal denied");
    await expect(driver.writeFile("/etc/passwd", "malicious")).rejects.toThrow("Path traversal denied");
  });
});
