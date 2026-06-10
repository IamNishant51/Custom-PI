import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError, getCircuitBreaker } from "../circuit-breaker";

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker("test");
    expect(cb.state).toBe("closed");
  });

  it("passes through successful calls", async () => {
    const cb = new CircuitBreaker("test-success");
    const result = await cb.call(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.failureCount).toBe(0);
  });

  it("opens after threshold failures", async () => {
    const cb = new CircuitBreaker("test-open", { threshold: 3, resetTimeout: 60000 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("open");
  });

  it("throws CircuitBreakerOpenError when open", async () => {
    const cb = new CircuitBreaker("test-throw", { threshold: 1, resetTimeout: 60000 });
    await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    await expect(cb.call(async () => "should not run")).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("calls fallback when open", async () => {
    const cb = new CircuitBreaker("test-fallback", { threshold: 1, resetTimeout: 60000 });
    await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    const result = await cb.call(async () => "should not run", async () => "fallback");
    expect(result).toBe("fallback");
  });

  it("resets after resetTimeout in half-open", async () => {
    const cb = new CircuitBreaker("test-half", { threshold: 1, resetTimeout: 10 });
    await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(cb.state).toBe("open");
    await new Promise(r => setTimeout(r, 20));
    expect(cb.isOpen()).toBe(false);
    expect(cb.state).toBe("half-open");
  });

  it("closes after successful half-open call", async () => {
    const cb = new CircuitBreaker("test-close", { threshold: 1, resetTimeout: 10 });
    await expect(cb.call(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    await new Promise(r => setTimeout(r, 20));
    const result = await cb.call(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");
  });

  it("getCircuitBreaker returns shared instance", () => {
    const cb1 = getCircuitBreaker("shared");
    const cb2 = getCircuitBreaker("shared");
    expect(cb1).toBe(cb2);
  });
});
