# custom-pi: Developer & AI Agent Guide (AGENT.md)

Welcome, AI Coding Agent. This document outlines the custom-pi architecture, development rules, interface customisations, and security mechanisms. Read this document carefully before making any edits to the codebase.

---

## 📋 Git Workflow & Policy (CRITICAL)

When you make changes to this repository, you **MUST** follow this git policy strictly:
1. **Commit your changes locally** after completing any phase or requested feature.
2. **DO NOT run `git push` automatically.** 
3. **Wait for the user's explicit confirmation** in the chat before pushing any commits to GitHub.
4. **Exception**: If the user's current request explicitly says to "commit and push", you may push. Otherwise, default to "commit only".

---

## 📂 Codebase Architecture & Directory Map

The wrapper hooks into the standard globally-installed `@earendil-works/pi-coding-agent` via file synchronisation. Below is the file mapping:

```
.
├── AGENT.md                       # This file (AI Agent Developer Guide)
├── package.json                   # Root package settings & run scripts
├── tsconfig.json                  # TS compilation options
├── bin/
│   ├── cli.js                     # Syncs assets to ~/.pi/agent/ & spawns TUI
│   └── web.js                     # Syncs web client/server assets & spawns web UI
├── assets/                        # Active source templates copied to ~/.pi/agent/
│   ├── SYSTEM.md                  # Custom agent instructions injected on launch
│   ├── models.json                # Model endpoint routing config
│   ├── settings.json              # Custom agent UI settings
│   ├── mcp-servers.json           # Active MCP server registry
│   ├── agents/                    # Swarm node definitions (builder, researcher, etc.)
│   ├── themes/                    # Visual themes (e.g. custom-pi-quantum.json)
│   ├── extensions/
│   │   └── subagents/
│   │       ├── package.json       # Subagent extension dependencies
│   │       └── src/
│   │           ├── index.ts       # Extension entry, TUI patching, mouse click handler
│   │           ├── gateguard.ts   # Command validation & safety gatekeeper
│   │           ├── secret-vault.ts# AES-256-GCM credential vault manager
│   │           ├── state-db.ts    # SQLite state and telemetry store
│   │           ├── memory-*       # TF-IDF semantic vector memory & retreival
│   │           ├── skill-*        # Procedural skill embedding store
│   │           └── tui/           # Low-level visual terminal widgets & managers
│   └── web/
│       ├── web-server.mjs         # Fastify backend (REST api & WebSockets)
│       └── client/                # React + Vite frontend dashboard
```

---

## ⌨️ TUI Customisation & The Input Box

The terminal user interface is dynamically patched on runtime by intercepting prototype methods of the host Pi coding agent.

### 1. Prototype Monkey-Patching Pattern
In `assets/extensions/subagents/src/index.ts`, the extension hooks the parent TUI rendering process inside `applyLivePatches()`.
It intercepts the `Container.prototype.render` method to identify component constructors by name:
```typescript
ContainerPrototype.render = function (this: any, width: number) {
  if (this.children) {
    for (const child of this.children) {
      if (!child) continue;
      const className = child.constructor?.name;
      if (className === "CustomEditor") {
        patchCustomEditor(Object.getPrototypeOf(child));
      } else if (className === "DynamicBorder") {
        patchDynamicBorder(Object.getPrototypeOf(child));
      } else if (className === "FooterComponent") {
        patchFooterComponent(child);
      }
      // ... UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent
    }
  }
  // ...
}
```

### 2. Modifying the Input Box (`CustomEditor`)
The input box styling is defined in `patchCustomEditor(proto: any)` inside `assets/extensions/subagents/src/index.ts`. 

Key control variables and hooks:
* **Prompt Symbol**: The prefix character and color are defined by:
  ```typescript
  const prefixStr = pointerColor("❯ ");
  ```
  Change `"❯ "` or the `pointerColor` callback to modify the prompt icon.
* **Top/Bottom Boundaries & Dividers**:
  * The input area separates itself from the conversation scrollback via a sleek horizontal line:
    ```typescript
    const horizontalStr = "─".repeat(width);
    const horizontal = dimFn(horizontalStr);
    ```
  * Scrolled-up indicator:
    ```typescript
    const indicator = `─── ↑ ${this.scrollOffset} more `;
    ```
  * Scrolled-down indicator:
    ```typescript
    const indicator = `─── ↓ ${linesBelow} more `;
    ```
* **Height & Wrap Boundaries**:
  * Wrap width calculation is performed via `this.layoutText(layoutWidth)`.
  * The visible rows are calculated with respect to total terminal rows:
    ```typescript
    const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
    ```
* **Autocomplete & Dropdown**:
  * When autocomplete suggestions are active, they are appended to the return buffer:
    ```typescript
    const autocompleteResult = this.autocompleteList.render(contentWidthForText);
    ```

### 3. Removing surrounding borders (`DynamicBorder`)
To keep the input layout flat, clean, and minimal, `patchDynamicBorder` is used:
```typescript
function patchDynamicBorder(proto: any) {
  if (dynamicBorderPatched) return;
  dynamicBorderPatched = true;
  proto.render = function (this: any, width: number) {
    return []; // Return empty array to eliminate outer box lines
  };
}
```
If you need to restore or custom-style the surrounding border box, modify this function.

### 4. Tool Execution Status Dot Blinking
The status dot in the `ToolExecutionComponent` indicates execution state:
* When running (`isRunning` is true), the dot blinks by toggling between a hollow circle `○` (`\u25cb`) and a solid circle `●` (`\u25cf`) using the global animation tick `getGlobalFrame()`:
  ```typescript
  const dotChar = isRunning && (getGlobalFrame() % 6) < 3 ? "\u25cb" : "\u25cf";
  ```
* On completion (or if not running), it remains solid `●`.
* The color maps to state: orange for running, red for error, green for success.

### 5. Abort Signal Propagation (`ESC` key aborts)
To prevent hanging loops when a user presses the escape/abort key (`ESC`):
* The sub-agent runner and parallel swarm handlers track the `signal: AbortSignal`.
* Sub-agent parallel runners listen to `"abort"` on this signal to terminate global animations and clear the active indicators:
  ```typescript
  signal.addEventListener("abort", () => {
    stopGlobalAnimation();
    context.ui.setWorkingIndicator();
    context.ui.setWorkingMessage();
    context.ui.setStatus("subagents", undefined);
  }, { once: true });
  ```
* In `execute()` loops, early returns are triggered if `this.signal?.aborted` is detected to break out of retries.

---

## 🌐 Web Dashboard (React + Fastify)

The web dashboard provides a real-time visual counterpart to the TUI.

1. **Fastify Backend (`assets/web/web-server.mjs`)**:
   * Listens on `process.env.WEB_PORT` (default: `4321`).
   * Uses `@fastify/websocket` to broadcast real-time tool logs, reasoning streams, and message threads to connected web browsers.
   * Leverages `@fastify/static` to serve pre-built React production client bundles from `client/dist`.

2. **React Client (`assets/web/client`)**:
   * Initiated via Vite.
   * Run client development mode: `cd assets/web/client && npm run dev`
   * Build client bundle: `npm run build:web` (or `npm run build` within the folder).

---

## 🔒 Security & Optimization Guidelines

When adding tools, commands, or handling input, observe the following rules:

### 1. Command Injection Prevention
Never pass raw, unsanitized user inputs or file names to shell command strings.
* **Bad**: `execSync("espeak " + text)`
* **Good**: Execute commands with array arguments via `spawn` or `execFileSync` to bypass shell parsing.
* Sanitize filenames to prevent path traversal (`../`) and dangerous characters (`;`, `&`, `|`, `$`, `` ` ``).

### 2. Vault Key Protection & Secret Leak Prevention
* All credentials, tokens, and OAuth keys must be stored in the AES-256-GCM encrypted database vault managed by `assets/extensions/subagents/src/secret-vault.ts`.
* **Redact Secrets**: When printing telemetry logs, writing to the web WebSocket stream, or returning tool results, ensure secrets and private variables are completely redacted. (e.g. replacing token values with `[REDACTED]`).

### 3. ReDoS Protection (Regular Expression Safety)
* Avoid using complex, non-anchored regular expressions that can cause exponential backtracking (Regular Expression Denial of Service).
* Use simple regex patterns, or enforce string length limits before applying regex checks.

### 4. Fastify Authentication
* When exposing the Fastify server, secure API endpoints and WebSocket handshakes using API keys. Ensure requests without matching keys return `401 Unauthorized` responses.

---

## 💡 Best Practices for Editing Code
* **Read Before Modifying**: Always read the destination files first using `view_file` to grasp the existing styles and helpers.
* **Keep Changes Narrow**: Focus precisely on the task. Do not make unrelated changes or cleanups.
* **Test the Build**: After updating files in `assets/extensions/subagents/src/`, make sure they compile cleanly and run correctly.
