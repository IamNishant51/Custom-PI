import { describe, it, expect, beforeAll, afterAll } from "vitest";

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

  it("serves static files from client dist", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain("<!DOCTYPE html>");
  });
});
