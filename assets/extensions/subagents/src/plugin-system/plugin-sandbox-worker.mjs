import { parentPort, workerData } from "node:worker_threads";

try {
  const { code, hook, context } = workerData;
  const exports = {};
  const fn = new Function("exports", "context", `"use strict";\n${code}\n;exports["${hook}"](context);`);
  fn(exports, context);
  parentPort.postMessage(exports);
} catch (err) {
  parentPort.postMessage({ _error: err instanceof Error ? err.message : String(err) });
}
