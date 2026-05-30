import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4322,
    proxy: {
      "/api": "http://localhost:4321",
      "/ws": {
        target: "ws://localhost:4321",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
