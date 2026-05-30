import { describe, it, expect } from "vitest";
import { runVerification } from "../verification-engine";

describe("Formal Verification Engine Assertions", () => {
  it("should block direct global window mutations", async () => {
    const badCode = `
      function init() {
        window.userSession = { token: "abc" };
      }
    `;
    const res = await runVerification(badCode, "");
    expect(res.passed).toBe(false);
    expect(res.errors[0]).toContain("No Global Window Mutations");
  });

  it("should block API keys or secrets", async () => {
    const badCode1 = `
      const config = {
        githubToken: "ghp_123456789012345678901234567890123456"
      };
    `;
    const res1 = await runVerification(badCode1, "");
    expect(res1.passed).toBe(false);
    expect(res1.errors[0]).toContain("No Exposed Secrets");

    const badCode2 = `
      const apiKey = "abcdef1234567890abcdef1234567890";
    `;
    const res2 = await runVerification(badCode2, "");
    expect(res2.passed).toBe(false);
  });

  it("should warn on placeholder comments or TODO comments", async () => {
    const lazyCode = `
      function processOrder() {
        // TODO: implement later
      }
    `;
    const res = await runVerification(lazyCode, "");
    expect(res.passed).toBe(true); // Warnings do not block 'passed'
    expect(res.warnings[0]).toContain("No Placeholder");
  });

  it("should warn on hardcoded host absolute paths", async () => {
    const badCode = `
      const configPath = "/home/nishant/config.json";
    `;
    const res = await runVerification(badCode, "");
    expect(res.passed).toBe(true); // Warnings do not block 'passed'
    expect(res.warnings[0]).toContain("No Hardcoded Absolute Host Paths");
  });

  it("should pass clean, compliant code", async () => {
    const cleanCode = `
      import React from "react";
      
      export function App() {
        const [count, setCount] = React.useState(0);
        return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>;
      }
    `;
    const res = await runVerification(cleanCode, "");
    expect(res.passed).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.warnings.length).toBe(0);
  });
});
