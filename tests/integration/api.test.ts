import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";

const PORT = 19876;
const BASE = `http://127.0.0.1:${PORT}`;

describe("Web API Integration", () => {
  let server: http.Server;

  beforeAll(async () => {
    const { createApp } = await import("../../assets/web/web-server.mjs");
    const fastify = await createApp();
    server = http.createServer((req, res) => {
      fastify.server.emit("request", req, res);
    });
    await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  }, 15000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("responds with 200 on health endpoint", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
  });

  it("serves static files from client dist", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });
});
