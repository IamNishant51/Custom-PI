# Custom-PI: Developer & AI Agent Guide

This document defines the architecture, workflow rules, CI/CD requirements, and code conventions for the custom-pi project. Read it before making any edits.

---

## 🚨 CI/CD Pipeline — Must Pass Before Any Commit

Every commit **MUST** pass both checks locally before staging:

```bash
npx tsc --noEmit          # Zero type errors
npx vitest run            # All 348 tests, 40 files, 0 failures
```

### Critical Test Behaviors (CI vs Local)

| Test | Behavior | Why |
|------|----------|-----|
| `api.test.ts > serves static files from client dist` | Expects `GET /` → 200 + `<!DOCTYPE html>` | The SPA fallback (`setNotFoundHandler`) is registered unconditionally. If `client/dist/index.html` exists, it's served; otherwise returns clean 404. **Never gate the not-found handler behind `fs.existsSync(CLIENT_DIR)`** — that breaks CI. |
| `api.test.ts > responds with 200 on health endpoint` | `GET /api/health` → 200 + `{ status: "ok" }` | Always works; no deps. |
| All other tests | Pure unit/integration tests with no network or filesystem deps | Mock everything. |

### Golden Rules
1. **Never remove `@ts-nocheck` from `index.ts`** — ~74 implicit `any` errors from Pi API callback params. Phase 1.1 will decompose it.
2. **Never change `skipLibCheck` to `false` in `tsconfig.json`** — vendor `.d.ts` files from `@earendil-works/*` have incompatible declarations.
3. **Never gate the SPA fallback handler** — `app.setNotFoundHandler()` must always be registered, regardless of `client/dist` existence.
4. **Never add unused root `devDependencies`** — the last cleanup removed `@testing-library/jest-dom`, `@testing-library/react`, `jsdom`.

---

## 📋 Git Workflow & Policy

1. **Commit locally** after completing any task.
2. **Do NOT push automatically** — wait for the user's explicit `commit and push` command.
3. **Exception**: If the user says "commit and push" in the current request, you may push.
4. **Commit message style**: Short, prefixed by area, e.g. `Fix CI: move setNotFoundHandler outside client-dist guard`.
5. `package-lock.json` changes are expected after dep changes — commit them.

---

## 📂 Codebase Architecture

```
.
├── AGENT.md                       # This file
├── package.json                   # Root scripts & deps
├── tsconfig.json                  # TS compilation (skipLibCheck: true, noUnusedLocals/Parameters: false)
├── bin/
│   ├── cli.js                     # Syncs assets to ~/.pi/agent/ & spawns TUI
│   └── web.js                     # Syncs web assets & spawns web UI
├── assets/
│   ├── SYSTEM.md                  # Custom agent system prompt
│   ├── models.json                # Model endpoint routing (contextWindow per model)
│   ├── settings.json              # Agent settings (compaction: { enabled: true } only)
│   ├── mcp-servers.json           # MCP server registry
│   ├── agents/                    # Swarm node definitions
│   ├── themes/                    # Visual themes
│   ├── extensions/subagents/src/  # Extension source (TS)
│   │   ├── index.ts               # Entry point, tools, commands, hooks (~3000 lines)
│   │   ├── daemon/daemon.ts       # Background task scheduler (SQLite-only persistence)
│   │   ├── secret-vault.ts        # AES-256-GCM vault manager
│   │   ├── state-db.ts            # SQLite state & telemetry
│   │   ├── context-monitor.ts     # Context usage tracking & auto-learn
│   │   └── ... (memory, skill, tui, runtime, swarm, cognition)
│   └── web/
│       ├── web-server.mjs         # Fastify backend (REST + WebSocket, 7500+ lines)
│       ├── social-bridge.mjs      # Twitter/Reddit bridge (requires x-api-key)
│       ├── email-bridge.mjs       # Email bridge (requires x-api-key, path validation)
│       └── client/                # React + Vite frontend (build to client/dist)
```

---

## 🔧 Compaction & Context Management

### Dynamic Compaction (DO NOT HARDCODE)

Compaction settings are calculated **dynamically** from the model's `contextWindow` on every `session_start`:

```
assets/extensions/subagents/src/index.ts :2180 (session_start handler)
```

Logic:
1. Reads `contextWindow` from `ctx.model` (set in `models.json` per-provider)
2. `reserveTokens = max(4096, contextWindow * 0.12)` — 12% headroom prevents overflow
3. `keepRecentTokens = max(8192, contextWindow * 0.40)` — 40% recent conversation preserved
4. Writes to `~/.pi/agent/settings.json` only if values changed

**Rules:**
- Never hardcode `reserveTokens` or `keepRecentTokens` in `settings.json`
- `settings.json` compaction section must only contain `"enabled": true`
- If adding a new provider/model, ensure its `contextWindow` in `models.json` is correct

### Context Monitor

- `turn_end` hook tracks usage %, warns at thresholds, auto-compacts at >90%
- Auto-compaction uses `session.compact()` — patched in `_runAutoCompaction` for silent overflow retries

---

## 🔒 Security & Hardening (Implemented)

All items below are **already implemented**. Do not regress them:

| Area | Implementation |
|------|---------------|
| **WebSocket auth** | Token validated via query param with `crypto.timingSafeEqual` |
| **Plugin sandbox** | `Object.create(null)` per invocation, `ALLOWED_HOOK_NAMES` allowlist |
| **Plugin installer** | `spawn("npm", [...])` / `spawn("git", [...])` — no shell |
| **Bash tool** | Allowlist of 60+ commands, segment-aware piping check |
| **GITHUB_TOKEN** | Replaced URL-embedded token with `GIT_ASKPASS` temp script |
| **CORS** | Strict origin match (no wildcard `*`) |
| **Webhook** | `validateSignature()`, 1MB payload limit |
| **API key auth** | `crypto.timingSafeEqual` for bearer token, `x-api-key`, WS token |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| **MCP command filter** | Exact command name matching (`npx`, `node`, `uvx`, `python3`, `deno`, `bun`) |
| **SSH password** | `sshpass -e` (env var, not visible in `ps`) |
| **MCP probes** | Validated against command allowlist before spawn |
| **SSRF prevention** | `isPrivateUrl()` resolves DNS, blocks RFC 1918 |
| **safeResolve()** | Fails closed on `realpathSync` failure, prefix match |
| **Vault perms** | `vault.json` written with `{ mode: 0o600 }` |
| **Rate limiting** | Vault (10 burst, 2/sec), Settings (5 burst, 1/sec), Social (3 burst, 1/5sec) |
| **Startup validation** | Warns on missing `PI_API_KEY`, insecure `CORS_ORIGIN=*`, Node <18 |
| **Error messages** | Sanitized — no `e.message` leak to client |
| **Centralized error handler** | `app.setErrorHandler()` logs full stack server-side, returns sanitized message |

---

## ⚡ Performance Patterns (Implemented)

| Pattern | Location |
|---------|----------|
| Logger write queue capped at 1000 | `logger.ts` |
| MCP health cache capped at 100 | `mcp-catalog.ts` with `setHealthEntry()` |
| setInterval cleanup | All timers have `stop()`/`clearInterval` paths (cron-scheduler, daemon, telemetry-pipeline, quantum-hud) |
| `bcast()` wrapped in `withSwarmLock()` | `web-server.mjs:315` — prevents race on `currentSwarmState` |

---

## 🧹 Code Quality Conventions

### Empty Catch Blocks
- **Never** leave bare `catch {}` — always log or handle
- Safe catches (non-critical path): `catch (err: any) { logger.warn(...) }`
- Intentional no-ops: comment explaining why (`// telemetry write must never crash`)
- Catch blocks that may hide bugs: add `logger.warn()` at minimum

### Magic Numbers
- Extract named constants with descriptive names
- Keep as `const` at module scope
- See `index.ts`: `CHECKPOINT_STALE_MS`, `COMPACT_RESERVE_RATIO`, `COMPACT_KEEP_RATIO`, `MEMORY_TTL_DAYS`, `SKILL_TTL_DAYS`
- See `consolidation.ts`: `SIMILARITY_MERGE_THRESHOLD`, `MAX_COMPARISONS`, `LOW_IMPORTANCE_THRESHOLD`
- See `context-monitor.ts`: `MAX_FILE_MODIFICATIONS`

### Lock Pattern
- `withSwarmLock()` is the ONLY way to mutate `currentSwarmState`
- Never mutate `currentSwarmState.xxx` directly outside the lock
- The lock acquire/release sequence: save prev, create new promise with release, await prev, execute, finally release

### Daemon Persistence
- SQLite is the primary store (`store.kvSet` + `store.kvGet`)
- JSON file writes have been removed from `saveState()`
- JSON read fallback retained for backward compat in `loadState()`

---

## 🧠 TUI Customisation (Summary)

The TUI is patched at runtime via prototype monkey-patching in `applyLivePatches()`:

| Component | Patch | Location |
|-----------|-------|----------|
| `Container.prototype.render` | Identifies child components by `constructor.name` | `index.ts` |
| `CustomEditor` (input box) | Custom prompt symbol, horizontal dividers, scroll indicators | `patchCustomEditor()` |
| `DynamicBorder` (border) | Returns `[]` to eliminate outer box lines | `patchDynamicBorder()` |
| `FooterComponent` | Custom status indicators | `patchFooterComponent()` |
| `ToolExecutionComponent` | Blinking status dot via `getGlobalFrame()` | `index.ts` |

---

## 🧪 Test Conventions

- Framework: **vitest** (v4)
- Config: `vitest.config.ts` in root
- Test files: `**/__tests__/*.test.ts` and `tests/integration/*.test.ts`
- No DOM/jsdom — all tests are Node-based
- Integration tests create a real Fastify app instance via `createApp()`

### Writing Tests
1. Place unit tests near source: `src/__tests__/foo.test.ts`
2. Place integration tests in root `tests/integration/`
3. Use `beforeAll`/`afterAll` for setup/teardown
4. Never depend on external network or files not in the repo

---

## 🌐 Web Server Conventions

### `web-server.mjs` (Fastify, ~7500 lines)
- Security headers hook → rate limiting hooks → centralized error handler → routes → static files → SPA fallback
- `setErrorHandler` must be set BEFORE routes but AFTER security hooks
- `setNotFoundHandler` (SPA fallback) must be registered **unconditionally** — not inside `if (fs.existsSync(CLIENT_DIR))`
- `bcast()` wraps state mutations in `withSwarmLock()`

### Critical File Paths
- `PI_DIR = path.join(os.homedir(), ".pi", "agent")`
- `CLIENT_DIR = path.join(__dirname, "client", "dist")`
- `settings.json` at `~/.pi/agent/settings.json` (NOT `assets/settings.json` at runtime)

### Model Config (`models.json`)
- Each provider has `contextWindow` — this drives compaction and prompt injection budgets
- Default model: `google/gemma-4-e4b` via `lmstudio` (contextWindow: 131072)
- Fallback model hardcodes `contextWindow: 4096` — used only if models.json is unreadable

---

## 📦 Package Management

- `package.json` root has minimal deps — only what the extension and web server need
- `@types/better-sqlite3` is in `devDependencies` (not dependencies)
- `glob` is a runtime dependency (used by sync scripts)
- Unused deps get removed (e.g., `@testing-library/*`, `jsdom`)
- Run `npm audit fix` after adding deps; `@fastify/static` v8→v9 deferred (breaking change)

---

## 🚫 What NOT To Do

- **Do NOT** change `skipLibCheck` in `tsconfig.json`
- **Do NOT** remove `@ts-nocheck` from `index.ts`
- **Do NOT** hardcode `reserveTokens`/`keepRecentTokens` in `settings.json`
- **Do NOT** gate `setNotFoundHandler` behind `fs.existsSync(CLIENT_DIR)`
- **Do NOT** mutate `currentSwarmState` outside `withSwarmLock()`
- **Do NOT** write JSON state files when SQLite is available (daemon, etc.)
- **Do NOT** add unused devDependencies to root `package.json`
- **Do NOT** push without user confirmation
- **Do NOT** skip `npx tsc --noEmit` and `npx vitest run` before commit
