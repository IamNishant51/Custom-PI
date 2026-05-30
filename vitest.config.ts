import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "assets/extensions/subagents/src/__tests__/**/*.test.ts",
      "assets/web/__tests__/**/*.test.ts",
      "assets/web/__tests__/**/*.test.tsx",
    ],
    environment: "node",
    setupFiles: ["assets/extensions/subagents/src/__tests__/setup.ts"],
    fileParallelism: false,
  },
});
