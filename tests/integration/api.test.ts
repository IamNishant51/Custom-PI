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

  it("responds on budget stats", async () => {
    const res = await app.inject({ method: "GET", url: "/api/budget/stats" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("totalCostUsd");
    expect(body).toHaveProperty("dailyTokens");
  });

  it("responds on budget config", async () => {
    const res = await app.inject({ method: "GET", url: "/api/budget/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("maxSessionTokens");
    expect(body).toHaveProperty("maxDailyTokens");
  });

  it("responds on budget forecast", async () => {
    const res = await app.inject({ method: "GET", url: "/api/budget/forecast" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("dailyAvgCost");
    expect(body).toHaveProperty("projectedMonthlyCost");
  });

  it("responds on flags", async () => {
    const res = await app.inject({ method: "GET", url: "/api/flags" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(typeof body).toBe("object");
  });

  it("responds on migrations status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/migrations/status" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("applied");
  });

  it("responds on notifications", async () => {
    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("notifications");
  });

  it("responds on undo history", async () => {
    const res = await app.inject({ method: "GET", url: "/api/undo/history" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("actions");
  });

  it("responds with not found for unknown routes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("responds with error for bad request body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/flags",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("error");
  });

  it("responds on auth tokens", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/tokens" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("tokens");
  });

  (hasClientBuild ? it : it.skip)("serves static files from client dist", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("<!DOCTYPE html>");
  });
});
