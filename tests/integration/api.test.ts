import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../assets/web/client/dist");
const hasClientBuild = fs.existsSync(path.join(CLIENT_DIR, "index.html"));

describe("Web API Integration", () => {
  let app: Awaited<ReturnType<typeof import("../../assets/web/web-server.mjs")["createApp"]>>;

  beforeAll(async () => {
    const { createApp } = await import("../../assets/web/web-server.mjs");
    app = await createApp();
  }, 15000);

  afterAll(async () => {
    await app.close();
  });

  it("responds with 200 on health endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("status", "ok");
  });

  (hasClientBuild ? it : it.skip)("serves static files from client dist", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("<!DOCTYPE html>");
  });
});
