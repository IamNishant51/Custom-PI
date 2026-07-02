# CUSTOM-PI — CLAUDE DEEP DIVE IMPROVEMENTS
> **Version audited:** v1.11.0 | **Date:** 2026-06-25 | **Auditor:** Claude Sonnet 4.6
> **Stack:** TypeScript + Node.js 18+ | Fastify 5 backend | React + Vite frontend | SQLite (better-sqlite3) | Playwright | Pi Coding Agent (@earendil-works)

---

## EXECUTIVE SUMMARY

custom-pi is an ambitious, genuinely impressive piece of work — a cyberpunk-flavored autonomous AI agent shell wrapping the Pi Coding Agent with 26+ subsystems, a 40+ tool arsenal, a full-blown React Web UI, a TUI, and everything from knowledge-graph memory to social media automation. At v1.11.0 the project has shipped 14 releases in roughly three weeks, which means the core functionality is battle-tested in the happy path but the architecture carries a lot of fast-ship technical debt that will compound if not addressed.

This document is a **complete, prioritised, surgical improvement plan** covering every layer of the stack. Nothing is vague. Every item includes the exact file, the exact problem, and the exact fix.

---

## TABLE OF CONTENTS

1. [Architecture & Structural Debt](#1-architecture--structural-debt)
2. [TypeScript & Type Safety](#2-typescript--type-safety)
3. [TUI — Terminal Dashboard](#3-tui--terminal-dashboard)
4. [Web UI — React Frontend](#4-web-ui--react-frontend)
5. [Web Server — Fastify Backend](#5-web-server--fastify-backend)
6. [Memory System](#6-memory-system)
7. [Agent & Swarm Engine](#7-agent--swarm-engine)
8. [Security Hardening](#8-security-hardening)
9. [Performance & Bundle](#9-performance--bundle)
10. [Testing & CI/CD](#10-testing--cicd)
11. [Developer Experience](#11-developer-experience)
12. [AI/ML Intelligence Layer](#12-aiml-intelligence-layer)
13. [Social Media & Media Pipeline](#13-social-media--media-pipeline)
14. [Voice & TTS](#14-voice--tts)
15. [Desktop Application — Windows / Linux / macOS](#15-desktop-application--windows--linux--macos)
16. [Documentation](#16-documentation)
17. [Prioritised Backlog](#17-prioritised-backlog)

---

## 1. ARCHITECTURE & STRUCTURAL DEBT

### 1.1 `web-server.mjs` — Still Too Large

**File:** `assets/web/web-server.mjs`
**Current state:** Even after the v1.11.0 modularisation pass it is 5,577 lines. Social media (~950 lines), WebSocket handling (~230 lines), and session-chat CRUD (~150 lines) are still inline.

**Why it matters:** Single-file megaservers make merge conflicts inevitable, make unit-testing impossible (you can't import one route without loading all 5,577 lines), and make onboarding new contributors a nightmare.

**Exact fix:**
```
assets/web/
  routes/
    social.mjs          # Twitter, Reddit, Bluesky, Discord, Telegram
    websocket.mjs       # All ws:// upgrade and message dispatch
    session-chat.mjs    # Session CRUD + chat history
  lib/
    ws-session.mjs      # Stateful WebSocket session manager
```
Each file should be under 400 lines. `web-server.mjs` becomes a pure registration file: it imports all route modules, registers them with the Fastify instance, wires middleware, then exports `createApp()`.

### 1.2 `index.ts` — 3,066 Lines with `@ts-nocheck`

**File:** `assets/extensions/subagents/src/index.ts`
**Current state:** The single most critical file in the extension is entirely unchecked at the TypeScript level. The `@ts-nocheck` suppresses ~74 implicit `any` errors from Pi API callback params.

**Why it matters:** Runtime type bugs in the agent's core entry point are invisible until they crash a user session. The compiler is your fastest QA pass.

**Exact fix — incremental removal path:**
```
Phase 1: Split index.ts into:
  tools/           # Each tool as its own file with typed input/output
    web-search.ts
    browser.ts
    vault.ts
    ...40 others
  hooks/           # turn_start, turn_end, session_start, tool_call handlers
  commands/        # /models, /triplets, /daemon etc slash-commands
  patches/         # applyLivePatches(), patchCustomEditor() etc
  index.ts         # <200 line wiring file

Phase 2: Add Pi API type stubs:
  types/pi-api.d.ts   # Manually declare ToolContext, AgentCallbacks etc
                       # This eliminates the need for @ts-nocheck entirely
```

### 1.3 Daemon State Dual Write Regression

**File:** `assets/extensions/subagents/src/daemon/daemon.ts`
**Current state:** AGENT.md says JSON file writes were removed from `saveState()` but a JSON read fallback was retained for backward compat. This means the daemon's startup path still has two code paths for the same data.

**Exact fix:** Add a one-time migration on startup: if `daemon-state.json` exists, import it into SQLite, then delete the file. Remove the JSON fallback read path entirely after v1.12.0.

### 1.4 Lock Pattern — `withSwarmLock` is Single-Threaded JavaScript but Not Deadlock-Safe

**File:** `assets/web/web-server.mjs:315`
**Current state:** `withSwarmLock()` is a promise-based mutex. If an exception is thrown inside the lock body before `release()` is called, the lock is never released and the server deadlocks.

**Exact fix:**
```javascript
async function withSwarmLock(fn) {
  await lockAcquired;
  lockAcquired = new Promise(resolve => { release = resolve; });
  try {
    return await fn();
  } finally {       // ← THIS LINE IS MISSING. Add it.
    release();
  }
}
```
The `finally` guarantees release even on throw. This is a correctness bug, not just style.

### 1.5 Context Window Compaction — Hardcoded 12%/40% Ratios

**File:** `assets/extensions/subagents/src/index.ts:2180`
**Current state:** `COMPACT_RESERVE_RATIO = 0.12` and `COMPACT_KEEP_RATIO = 0.40` are magic constants that work well for GPT-4-class 128K context models but are wasteful for small models (4K context) and too conservative for million-token context models.

**Exact fix:** Make the ratios a function of `contextWindow`:
```typescript
function getCompactionParams(contextWindow: number) {
  if (contextWindow <= 8192)  return { reserve: 0.20, keep: 0.50 };
  if (contextWindow <= 32768) return { reserve: 0.15, keep: 0.45 };
  if (contextWindow <= 131072) return { reserve: 0.12, keep: 0.40 };
  return { reserve: 0.08, keep: 0.30 }; // million-token models
}
```

---

## 2. TYPESCRIPT & TYPE SAFETY

### 2.1 `skipLibCheck: true` — Vendor Type Conflicts Hidden

**File:** `tsconfig.json`
**Current state:** `skipLibCheck: true` suppresses all errors from `@earendil-works/*` vendor `.d.ts` files, which have incompatible declarations.

**Exact fix:** Don't change `skipLibCheck` globally (AGENT.md correctly forbids this). Instead, create a local ambient declaration to override the specific broken types:
```typescript
// types/pi-overrides.d.ts
declare module "@earendil-works/pi-coding-agent" {
  // Re-declare only the functions/types that are broken
  export interface ToolContext { /* correct types */ }
}
```
This gives you type safety for the Pi API without enabling the broken vendor types globally.

### 2.2 `noUnusedLocals: false` + `noUnusedParameters: false`

**File:** `tsconfig.json`
**Current state:** Both are disabled, meaning dead code accumulates silently.

**Exact fix:** Enable them, but use `_` prefix convention for intentionally unused params (which TypeScript respects):
```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```
Then prefix intentionally unused params with `_` (e.g., `_ctx`, `_event`). This is standard TS convention and eliminates dead code accumulation.

### 2.3 Tool Input/Output Types Not Defined

**Current state:** All 40+ tool definitions have `any` typed inputs and outputs because they live in the `@ts-nocheck` file.

**Exact fix:** Create a typed tool registry:
```typescript
// types/tools.ts
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

// Example:
interface WebSearchInput { query: string; maxResults?: number; }
interface WebSearchOutput { results: Array<{ title: string; url: string; snippet: string; }>; }
```
This makes tool calls type-safe end-to-end.

### 2.4 `ws-types.ts` — Good Foundation, Missing Discriminated Union Guard

**File:** `assets/web/client/src/ws-types.ts`
**Current state:** The 20+ server→client message types are defined as interfaces but there's no type guard utility, so every consumer does unsafe `as SomeType` casts.

**Exact fix:**
```typescript
export function isSwarmUpdate(msg: ServerMessage): msg is SwarmUpdateMessage {
  return msg.type === WS_TYPES.SWARM_UPDATE;
}
// One guard per message type. Eliminates all `as` casts.
```

---

## 3. TUI — TERMINAL DASHBOARD

### 3.1 Prototype Monkey-Patching is Fragile

**File:** `assets/extensions/subagents/src/index.ts` — `applyLivePatches()`
**Current state:** The TUI is customised by patching `Container.prototype.render`, `CustomEditor.prototype`, `DynamicBorder.prototype`, and `FooterComponent.prototype` at runtime. This approach breaks silently when the Pi agent upgrades its internal component names.

**Why it matters:** When `@earendil-works/pi-coding-agent` ships v0.78+, the constructor names might change and the entire TUI reverts to the default appearance with no error.

**Exact fix:** Wrap every patch in a guard that validates the target exists before patching, and logs a structured warning if it doesn't:
```typescript
function safePatch<T extends object>(target: T, methodName: keyof T, patch: Function, label: string) {
  if (typeof target[methodName] !== 'function') {
    logger.warn(`[TUI Patch] Cannot patch ${label}.${String(methodName)} — method not found. Pi agent may have been updated.`);
    return;
  }
  const original = target[methodName] as Function;
  (target as any)[methodName] = function(...args: any[]) {
    return patch.call(this, original.bind(this), ...args);
  };
}
```

### 3.2 TUI Missing: Session History Navigation

**Current state:** The TUI has no way to navigate back through previous sessions. Users lose context when they close the terminal.

**Exact fix:** Add `Ctrl+H` to open a session picker (list of archived sessions from SQLite), and `Ctrl+R` for reverse-search through past commands (like bash history). The SQLite FTS5 table already stores all messages — just expose it with a TUI overlay.

### 3.3 TUI Missing: Inline Tool Output Diff View

**Current state:** When the agent edits a file, the TUI shows the raw tool output as text. There is no visual diff.

**Exact fix:** Intercept the `hashline_edit` tool result and render it as a coloured unified diff in the TUI output area. Libraries like `diff` (npm) can generate the diff; rendering it with green/red ANSI colour codes is trivial.

### 3.4 TUI Missing: Multi-Pane Layout

**Current state:** The TUI is a single-pane vertical layout: border, agent output, input. The swarm commander is only accessible via the Web UI.

**Exact fix:** Add a `Ctrl+B` toggle that switches between single-pane and split-pane mode:
- Left pane: agent chat (current behaviour)
- Right pane: live swarm status (agent names, their current tool, progress)

This mirrors what tmux users do manually today.

### 3.5 TUI Agent Mode/Plan Mode Toggle Indicator

**File:** `assets/extensions/subagents/src/index.ts`
**Current state:** The `◆ AGENT MODE` / `◆ PLAN MODE` indicator is injected via the patched `FooterComponent`. If the patch fails silently (see 3.1), the mode indicator disappears with no fallback.

**Exact fix:** In addition to the footer patch, inject the mode indicator as a system message in the chat output stream. Even if the patch fails, the user sees `[MODE: AGENT]` or `[MODE: PLAN]` in the output.

### 3.6 TUI Blinking Dot — Global Frame Counter Memory Leak

**Current state:** `getGlobalFrame()` increments a counter every animation tick to produce the blinking tool status dot. If multiple tools run concurrently (parallel swarm), multiple `setInterval` timers accumulate.

**Exact fix:** Use a single shared animation ticker at the module level, and let individual tool components subscribe to it. The ticker runs one `setInterval` for the entire session.

### 3.7 TUI Keyboard Shortcut Conflicts with Terminal Emulators

**Current state:** `Ctrl+C`, `Ctrl+Z`, `Ctrl+R` are used in the TUI for internal functions. These conflict with standard terminal signals (`SIGINT`, `SIGTSTP`) and reverse-history-search in some terminal emulators.

**Exact fix:** Audit all TUI keybindings against `readline` defaults. Use `Ctrl+G` for swarm status toggle (unoccupied in readline). Document all keybindings in a `?` help overlay (same as the Web UI).

---

## 4. WEB UI — REACT FRONTEND

### 4.1 `SubAgentPanel.tsx` — Monolith at ~1,500 Lines

**File:** `assets/web/client/src/panels/SubAgentPanel.tsx`
**Current state:** This single component handles swarm lifecycle management, team CRUD, agent provisioning, column resize, and agent chat. It is the largest and most complex component in the frontend.

**Exact fix:**
```
panels/subagent/
  SwarmCommander.tsx       # Launch/stop swarms, view live agent logs
  TeamManager.tsx          # Create/edit/delete teams
  AgentGrid.tsx            # Agent card grid with status indicators
  ProvisioningPanel.tsx    # Configure agent roles, tools, wait-fors
  AgentChatPanel.tsx       # Per-agent conversation view
  hooks/
    useSwarm.ts            # WebSocket swarm subscription
    useTeams.ts            # Team CRUD with optimistic updates
```

### 4.2 `DocumentEditor` — localStorage Persistence is Fragile

**Current state:** The Document Editor saves documents to `localStorage`. This means documents are tied to a single browser/origin and are lost if the user clears browser data.

**Exact fix:** Move document persistence to the Fastify backend:
```
GET    /api/documents           — list all documents
GET    /api/documents/:id       — get document by id
POST   /api/documents           — create document
PUT    /api/documents/:id       — update document
DELETE /api/documents/:id       — delete document
```
The SQLite table is trivial: `id, title, content, created_at, updated_at`. The frontend replaces `localStorage` calls with API calls, gets persistence across devices.

### 4.3 Canvas Editor — No Backend Persistence for Drawings

**Current state:** Canvas drawings exist only in browser memory. If the user closes the tab, the drawing is lost.

**Exact fix:** Add a `Save` button that serialises the canvas to a PNG blob and uploads it to the existing image gallery endpoint (`POST /api/gallery/upload`). Add an `Open` flow that loads a gallery image into the canvas. The infrastructure already exists — the canvas just doesn't use it.

### 4.4 React Router Migration — 5 Panels Not Yet Migrated

**Current state:** The PI_IMP_PLAN.md notes that 5 panels (DocEditor, ThemeEditor, CanvasEditor, Login, SubAgent) still use the old hash router.

**Exact fix:** Each of these panels needs a `<Route path="/documents" element={<DocEditor />} />` entry in `App.tsx` and their internal navigation updated to use `useNavigate()`. This is mechanical work.

### 4.5 Missing: Real-time Swarm Progress in Chat Tab

**Current state:** The Chat tab shows streaming agent output but gives no visual indication of which swarm agent is currently running or what its progress is.

**Exact fix:** Add a sticky "Swarm Status Bar" at the top of the Chat panel when a swarm is active. It shows a compact row of agent pills, each with a status dot (idle / running / done / failed) and the current tool name. The data comes from the existing `swarm_update` WebSocket message.

### 4.6 Missing: Keyboard Shortcut for Model Switching

**Current state:** Switching models requires navigating to Settings → Models. There is no keyboard shortcut.

**Exact fix:** Add `Ctrl+M` to open a model picker modal — a searchable dropdown of all configured models. Selecting one updates the active model for the session. This is a 2-hour feature that power users will love.

### 4.7 Voice Agent Panel — 3D Globe Avatar Performance

**Current state:** The Voice Agent panel renders a Three.js `OrbitControls`-free particle globe that "reacts to speaking." On low-end machines or mobile browsers, Three.js causes frame drops that interfere with the voice UX.

**Exact fix:** Replace the Three.js globe with a CSS/SVG animation that achieves the same visual effect:
- SVG concentric animated rings that pulse in amplitude when TTS is active
- No WebGL dependency, zero bundle weight addition
- Graceful even on mobile

If the Three.js globe is important to identity, make it opt-in via a feature flag: `voice-3d-avatar: off` by default.

### 4.8 Missing: Dark/Light Theme System-Preference Sync

**Current state:** The theme system has multiple themes but doesn't respect `prefers-color-scheme` media query on first load.

**Exact fix:**
```typescript
// In ThemeProvider or App.tsx
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const defaultTheme = prefersDark ? 'cyberpunk' : 'light';
```
Persist the user's manual override in localStorage. This is a one-line fix with significant UX impact.

### 4.9 Missing: Offline Indicator

**Current state:** The service worker is set up for offline caching but there is no UI indicator telling the user they are offline and which features are unavailable.

**Exact fix:** Add an `OfflineBanner` component that listens to `navigator.onLine` and shows a banner when disconnected:
```typescript
useEffect(() => {
  const handler = () => setOnline(navigator.onLine);
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  return () => { window.removeEventListener('online', handler); window.removeEventListener('offline', handler); };
}, []);
```

### 4.10 Missing: Breadcrumb Navigation

**Current state:** When a user is deep in a navigation path (e.g., Settings > Models > LM Studio > Model Config), there is no breadcrumb. The only navigation is the sidebar.

**Exact fix:** Add a `<Breadcrumb />` component below the top nav bar that renders the current route path as clickable crumbs. React Router's `useMatches()` hook provides everything needed.

### 4.11 Feature Flag `undo-redo` is `off` but the Implementation Exists

**File:** `.feature-flags.json`
**Current state:** The undo/redo system was built (SQLite-backed action log, `UndoBar` component) but the feature flag is still `off`.

**Exact fix:** Turn it on. If there are stability concerns, add a timeout-based auto-clear:
```json
{ "undo-redo": { "value": "on" } }
```
The system is already built. Ship it.

### 4.12 Notification Center Feature Flag is `off`

**Same issue as 4.11.** The notification center was built with SQLite persistence and the `NotificationBell` component, but `notification-center: off`. Turn it on.

### 4.13 Image Gallery — Missing Pagination

**Current state:** The image gallery loads all images at once. If a user has generated 200+ images via `generate_image`, the gallery becomes slow and unresponsive.

**Exact fix:** Add server-side pagination to `GET /api/gallery`:
```
GET /api/gallery?page=1&limit=24
```
Frontend: virtual scroll or standard page navigation with prev/next buttons.

---

## 5. WEB SERVER — FASTIFY BACKEND

### 5.1 Remaining Inline Handlers — Social Media (950 lines)

**File:** `assets/web/web-server.mjs`
**Current state:** All Twitter/Reddit/Bluesky/Discord/Telegram posting logic is inline in the main server file.

**Exact fix:**
```
routes/social/
  twitter.mjs    # POST /api/social/twitter, browser automation with Playwright
  reddit.mjs     # POST /api/social/reddit
  bluesky.mjs    # POST /api/social/bluesky
  discord.mjs    # POST /api/social/discord
  telegram.mjs   # POST /api/social/telegram
  index.mjs      # Fastify plugin that registers all 5
```

### 5.2 API Versioning — `/api/v1/*` via Rewrite Hook

**Current state:** The `/api/v1/` prefix is implemented as an `onRequest` URL rewrite hook. This is fragile — it means `/api/v1/health` and `/api/health` are both valid, but their schema validation, rate limiting, and logging are registered on `/api/health` only.

**Exact fix:** Use Fastify's native prefix system:
```javascript
await app.register(async (v1) => {
  await v1.register(healthRoutes);
  await v1.register(chatRoutes);
  // ... all routes
}, { prefix: '/api/v1' });

// Backward compat: redirect /api/* to /api/v1/*
app.get('/api/*', (req, reply) => reply.redirect(`/api/v1/${req.params['*']}`));
```

### 5.3 `POST /api/webhooks/:source` — No Event Deduplication

**Current state:** The webhook listener parses events from Sentry/Datadog/GitHub and stores them as failure triplets. There is no deduplication. If Sentry retries a webhook 3 times (which it does by default on non-200 responses), you get 3 duplicate triplets.

**Exact fix:** Use a `webhook_delivery_id` column in the SQLite table:
```sql
CREATE TABLE IF NOT EXISTS webhook_events (
  delivery_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
```
Sentry, Datadog, and GitHub all send a unique delivery ID in their request headers. Extract it, use it as the primary key, and `INSERT OR IGNORE` to deduplicate.

### 5.4 `sharp` is Optional but Not Gracefully Degraded in All Paths

**File:** `lib/image-optimizer.mjs`
**Current state:** The image optimizer has a `try/catch` around `require('sharp')` but individual route handlers don't all check `sharpAvailable` before calling optimization functions.

**Exact fix:** Centralise the check:
```javascript
const imageOptimizer = sharpAvailable
  ? realOptimizer
  : { resize: (buf) => buf, toWebP: (buf) => buf }; // passthrough
```
Now every route uses `imageOptimizer.resize()` without checking — the passthrough handles the missing `sharp` case transparently.

### 5.5 Missing: Request ID Tracing

**Current state:** Each Fastify request gets a `req.id` (Fastify's default), but this ID is not propagated to:
- WebSocket messages (so you can't trace a WS event back to the HTTP request that started it)
- SQLite rows (so you can't trace a DB write back to the request that caused it)
- Agent tool calls (so you can't trace an agent action to the user request)

**Exact fix:** Add an `onRequest` hook that sets a correlation ID header and stores it in `AsyncLocalStorage`:
```javascript
import { AsyncLocalStorage } from 'async_hooks';
const requestContext = new AsyncLocalStorage();

app.addHook('onRequest', (req, reply, done) => {
  requestContext.run({ requestId: req.id }, done);
});
```
Then `getRequestId()` can be called from anywhere in the call stack.

### 5.6 Email Bridge — Path Traversal Hardening

**File:** `assets/web/email-bridge.mjs`
**Current state:** The email bridge is noted in AGENT.md as requiring path validation. Confirm that all file attachment paths go through `safeResolve()` before being accessed.

**Exact fix:** Add an explicit test case for `../../etc/passwd` style paths in the integration test suite:
```typescript
test('email bridge rejects path traversal', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/email/send',
    payload: { attachments: ['../../etc/passwd'] } });
  expect(res.statusCode).toBe(400);
});
```

### 5.7 Missing: `GET /api/openapi.json` — Full Schema Export

**Current state:** Swagger UI is at `/docs` but the raw OpenAPI JSON schema is not exported at a stable URL.

**Exact fix:**
```javascript
app.get('/api/openapi.json', (req, reply) => {
  reply.send(app.swagger());
});
```
This enables third-party clients (Postman, SDK generators) to consume the API schema.

---

## 6. MEMORY SYSTEM

### 6.1 TF-IDF Vector Memory — No Persistence Across Restarts

**Current state:** The `memory_store` / `memory_search` tools use TF-IDF vectors that are computed in-memory. If the server restarts, the index is rebuilt from SQLite rows but the TF-IDF weights are recomputed, which is slow for large corpora.

**Exact fix:** Persist the TF-IDF index as a serialised JSON blob in a `memory_index` key in the SQLite KV store. On startup, load the cached index if it exists (and the row count matches). Rebuild only when necessary.

### 6.2 Knowledge Graph — No Graph Visualisation in TUI

**Current state:** The Web UI has a `KnowledgeGraph` panel with a triplet table and entity drill-down. The TUI has `/triplets` and `/triplets <entity>` commands that output plain text.

**Exact fix:** Implement an ASCII graph renderer for the TUI:
```
/triplets --graph custom-pi
  ● custom-pi
  ├── uses ──► sqlite
  ├── has-tool ──► web_search
  ├── extends ──► pi-coding-agent (confidence: 0.95)
  └── built-with ──► fastify
```
This uses tree-connector line characters (which the codebase already uses elsewhere).

### 6.3 Dream Consolidation — No Visibility

**Current state:** Dream consolidation (offline episode replay during idle time) runs silently. Users have no way to see what was consolidated, what was pruned, or what was learned.

**Exact fix:** Write a `consolidation-report.md` to `~/.pi/agent/checkpoints/` on each consolidation run, summarising:
- Episodes replayed
- Triplets extracted
- Triplets merged or pruned
- New patterns identified

This also gives you a debug trail when the agent starts behaving unexpectedly.

### 6.4 Memory Pruning — `prune-log.json` Grows Unbounded

**Current state:** Every pruning run appends to `prune-log.json`. After weeks of operation, this file can become very large.

**Exact fix:** Rotate the log: keep the last 100 entries maximum:
```typescript
const MAX_PRUNE_LOG_ENTRIES = 100;
// After writing, trim:
if (pruneLog.length > MAX_PRUNE_LOG_ENTRIES) {
  pruneLog.splice(0, pruneLog.length - MAX_PRUNE_LOG_ENTRIES);
}
```

### 6.5 Hybrid Search — Dense Cosine Similarity is Computed in JS

**Current state:** Dense cosine similarity is computed in JavaScript (likely a loop over float arrays). This is O(n×d) per query where n is the corpus size and d is the embedding dimension — it will get slow above ~10,000 memories.

**Exact fix:** Use SQLite's `fts5` for the sparse search (already done) and add a `sqlite-vss` virtual table for the dense search. `sqlite-vss` compiles as a SQLite extension and enables ANN (approximate nearest-neighbour) search at 100x+ speed:
```sql
CREATE VIRTUAL TABLE memory_vss USING vss0(embedding(768));
```
This keeps the entire memory system inside SQLite — no external vector DB needed.

---

## 7. AGENT & SWARM ENGINE

### 7.1 DAG Config — No Validation on Load

**File:** `~/.pi/agent/dag-config.yaml`
**Current state:** The YAML is loaded and used directly. If a user makes a typo (e.g., `waits_for: [researche]` when the agent ID is `researcher`), the swarm silently hangs.

**Exact fix:** Add a validator that runs on swarm start:
```typescript
function validateDagConfig(config: DagConfig): ValidationResult {
  const agentIds = new Set(config.agents.map(a => a.id));
  for (const agent of config.agents) {
    for (const dep of agent.waits_for ?? []) {
      if (!agentIds.has(dep)) {
        return { valid: false, error: `Agent "${agent.id}" waits for unknown agent "${dep}"` };
      }
    }
  }
  // Check for cycles using topological sort
  return detectCycles(config.agents);
}
```

### 7.2 Swarm — Parallel Mode Race on Shared File Writes

**Current state:** In `parallel` mode, multiple agents can call `write` or `edit` on the same file simultaneously. Since each agent is a separate process-level call, there is no file-level locking.

**Exact fix:** Add a file-level advisory lock in the `hashline_edit` and `write` tools:
```typescript
const fileLocks = new Map<string, Promise<void>>();

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  while (fileLocks.has(path)) await fileLocks.get(path);
  let release!: () => void;
  fileLocks.set(path, new Promise(res => { release = res; }));
  try { return await fn(); }
  finally { fileLocks.delete(path); release(); }
}
```

### 7.3 Hive Mind — Consensus Voting Has No Quorum Handling

**Current state:** The Hive Mind does consensus voting for critical decisions. If 2 of 5 agents are stuck or have crashed, the remaining 3 agents might deadlock waiting for a quorum that never arrives.

**Exact fix:** Add a vote timeout:
```typescript
const VOTE_TIMEOUT_MS = 30_000;
async function collectVotes(topic: string, agents: Agent[]): Promise<VoteResult> {
  const votes = await Promise.allSettled(
    agents.map(a => Promise.race([a.vote(topic), timeout(VOTE_TIMEOUT_MS)]))
  );
  const fulfilled = votes.filter(v => v.status === 'fulfilled');
  if (fulfilled.length < Math.ceil(agents.length / 2)) {
    throw new Error(`Quorum not reached: ${fulfilled.length}/${agents.length} agents voted`);
  }
  return tally(fulfilled.map(v => (v as PromiseFulfilledResult<any>).value));
}
```

### 7.4 Self-Modifier — No Diff Preview Before Applying

**Current state:** The `Self-Modifier` subsystem can generate and apply patches to its own source code. There is no confirmation step for the user to review the diff before it's applied.

**Exact fix:** Add a mandatory approval gate:
1. Self-modifier generates the diff
2. Diff is displayed to the user via `request_post_approval` style modal in Web UI (or as a coloured diff block in TUI)
3. User approves/rejects
4. Only on approval: backup, apply, type-check, rollback on failure

This is a safety-critical change. Self-modification without human review is the single most dangerous operation in the system.

### 7.5 Security Autopilot — Severity Ratings Not Exposed in Web UI

**Current state:** The security autopilot scans for secret patterns and computes a security score, but the Web UI's Dashboard panel doesn't show the score or findings.

**Exact fix:** Add a `Security` section to the Dashboard panel:
```typescript
// Widget showing:
// Security Score: 87/100 🟡
// Last scan: 2 minutes ago
// Findings: 0 critical, 1 high (GitHub token in .env.bak)
// [View Details] button → opens Security panel
```

---

## 8. SECURITY HARDENING

### 8.1 Playwright Browser — No Network Isolation

**Current state:** Social media posting uses a persistent Playwright browser context with stored cookies. This browser context has full network access and can reach any URL.

**Why it matters:** If the agent is tricked into browsing to a malicious URL during a social media workflow, the browser can exfiltrate the stored session cookies.

**Exact fix:** Launch Playwright with a strict network proxy that only allows the expected domains:
```javascript
browser = await chromium.launch({
  proxy: { server: 'per-context' }
});
context = await browser.newContext({
  proxy: {
    server: 'http://localhost:8888', // Your allow-list proxy
    bypass: 'twitter.com,x.com,reddit.com,bsky.app,discord.com,t.me'
  }
});
```

### 8.2 Plugin Sandbox — `Object.create(null)` is Not a Security Boundary

**Current state:** AGENT.md documents the plugin sandbox as using `Object.create(null)` per invocation with an `ALLOWED_HOOK_NAMES` allowlist. In Node.js, this is not a real sandbox — a plugin can still call `process.exit()`, access `require('child_process')`, or do anything Node.js allows.

**Exact fix:** Run plugins in a Worker Thread with a restricted environment:
```typescript
import { Worker } from 'worker_threads';

async function runPlugin(code: string, context: PluginContext): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads');
      // No require(), no process.exit(), no fs access
      const fn = new Function('context', workerData.code);
      parentPort.postMessage(fn(workerData.context));
    `, { eval: true, workerData: { code, context } });
    worker.on('message', resolve);
    worker.on('error', reject);
    setTimeout(() => { worker.terminate(); reject(new Error('Plugin timeout')); }, 5000);
  });
}
```

### 8.3 AES-256-GCM Vault — Key Rotation Not Supported

**Current state:** The vault uses a master key stored at `~/.pi/agent/.vault/master.key`. There is no mechanism to rotate this key (e.g., if the key file is compromised).

**Exact fix:** Add a `vault_rotate_key` command:
```typescript
// 1. Generate new key
// 2. Decrypt all vault entries with old key
// 3. Re-encrypt all with new key
// 4. Write new key atomically (write to .vault/master.key.new, then rename)
// 5. Shred old key from memory
```
This is a P0 for any enterprise user.

### 8.4 SSH Tool — `sshpass -e` Still Leaks Key in `/proc`

**Current state:** AGENT.md notes SSH password is passed via `sshpass -e` (environment variable, not visible in `ps`). However, the environment variable is still visible to other processes running as the same user via `/proc/<pid>/environ`.

**Exact fix:** Use SSH key-based auth only. If password auth is required, use `expect` or the SSH `ControlMaster` + `ControlPath` mechanism to authenticate once and reuse the connection:
```bash
ssh -o ControlMaster=auto -o ControlPath=/tmp/ssh-%r@%h:%p -o ControlPersist=10m user@host
```

---

## 9. PERFORMANCE & BUNDLE

### 9.1 Three.js Bundle — 500KB+ Not Tree-Shaken

**Current state:** Three.js is imported as `import * as THREE from 'three'`, which imports the entire library.

**Exact fix:**
```typescript
// Before:
import * as THREE from 'three';

// After (only import what you use):
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { Scene } from 'three/src/scenes/Scene.js';
import { PerspectiveCamera } from 'three/src/cameras/PerspectiveCamera.js';
import { Points } from 'three/src/objects/Points.js';
import { BufferGeometry } from 'three/src/core/BufferGeometry.js';
import { PointsMaterial } from 'three/src/materials/PointsMaterial.js';
```
This reduces the Three.js contribution from ~500KB to ~80-120KB for the particle globe use case.

### 9.2 React Lazy Loading — 5 Panels Still Eager

**Current state:** 5 panels (DocEditor, ThemeEditor, CanvasEditor, Login, SubAgent) are not yet wrapped in `React.lazy()`.

**Exact fix:**
```typescript
const SubAgentPanel = React.lazy(() => import('./panels/SubAgentPanel'));
const CanvasEditor   = React.lazy(() => import('./panels/CanvasEditor'));
const DocEditor      = React.lazy(() => import('./panels/DocEditor'));
// Wrap each route in <Suspense fallback={<PanelLoadingSpinner />}>
```
SubAgentPanel alone should reduce initial bundle by ~15-20% due to Three.js and recharts dependencies.

### 9.3 SQLite WAL Mode Not Enabled

**Current state:** better-sqlite3 defaults to DELETE journal mode. WAL (Write-Ahead Logging) mode provides 3-5x better concurrent read performance and doesn't block reads during writes.

**Exact fix:** Add to database initialisation (one line):
```javascript
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // WAL + NORMAL is safe and fast
db.pragma('cache_size = -64000'); // 64MB page cache
db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
```

### 9.4 `getCostSummary()` — 5s Cache Still Queries on Every Cache Miss

**Current state:** The 5-second TTL cache for `getCostSummary()` prevents stampedes during the TTL window but still does a full table scan on every miss.

**Exact fix:** Add a materialised view that updates incrementally:
```sql
CREATE TABLE IF NOT EXISTS cost_summary_cache (
  period TEXT PRIMARY KEY,  -- 'today', 'this_week', 'this_month'
  total_tokens INTEGER,
  total_cost REAL,
  updated_at INTEGER
);
-- Trigger to update on INSERT to cost_log:
CREATE TRIGGER update_cost_summary AFTER INSERT ON cost_log BEGIN
  -- update the relevant period rows
END;
```

### 9.5 Image Gallery — `sharp` Resizing Not Streaming

**Current state:** `lib/image-optimizer.mjs` reads the entire image into memory, processes it with `sharp`, then sends the buffer. For large images (10MB uploads), this doubles peak memory usage.

**Exact fix:** Stream the image through sharp:
```javascript
reply.type('image/webp');
fs.createReadStream(imagePath).pipe(
  sharp().resize(targetWidth).webp({ quality: 80 })
).pipe(reply.raw);
```

---

## 10. TESTING & CI/CD

### 10.1 Integration Tests — Only 30% of Endpoints Covered

**Current state:** 406 tests across 43 files (impressive!) but the integration test coverage focuses on the top 10 called endpoints. ~70% of the 80+ endpoints have no integration test.

**Target coverage plan:**

| Priority | Endpoints to test | Complexity |
|---|---|---|
| P0 | `/api/vault/*` (AES crypto) | High — test encryption/decryption correctness |
| P0 | `/api/social/*` (Playwright) | High — requires browser mock |
| P0 | `/api/ssh/*` | High — requires SSH server mock |
| P1 | `/api/gallery/*` (file uploads) | Medium |
| P1 | `/api/webhooks/*` | Medium |
| P2 | All remaining CRUD endpoints | Low — straightforward |

### 10.2 CI Pipeline — No Performance Regression Gate

**Current state:** CI runs type-check and tests but has no performance assertions.

**Exact fix:** Add Lighthouse CI to the GitHub Actions workflow:
```yaml
- name: Lighthouse CI
  run: |
    npm install -g @lhci/cli
    lhci autorun --upload.target=temporary-public-storage
  env:
    LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```
Gate on: FCP < 3s, LCP < 4s, CLS < 0.1. These are achievable with the current codebase once Three.js is tree-shaken and lazy loading is complete.

### 10.3 CI Pipeline — No Dependency Audit on PR

**Current state:** Dependabot is configured (`.github/dependabot.yml`) but `npm audit` is not run as a CI gate.

**Exact fix:**
```yaml
- name: Security Audit
  run: npm audit --audit-level=high
```
This blocks PRs that introduce high/critical vulnerabilities.

### 10.4 Test for `@ts-nocheck` Removal — Progressive CI Gate

**Exact fix:** Add a CI step that counts the number of `@ts-nocheck` occurrences and fails if the count increases:
```bash
TS_NOCHECK_COUNT=$(grep -r "@ts-nocheck" src/ --include="*.ts" | wc -l)
echo "ts-nocheck count: $TS_NOCHECK_COUNT"
if [ "$TS_NOCHECK_COUNT" -gt "$MAX_ALLOWED" ]; then exit 1; fi
```
Start `MAX_ALLOWED=1` (current state) and decrement it with each PR that removes a `@ts-nocheck`.

### 10.5 Eval Harness — 5 Tasks is Too Few

**Current state:** `lib/eval-harness.mjs` has 5 test tasks (code_gen, tool_use, qa, reasoning, debugging).

**Exact fix:** Expand to 30+ tasks covering:
- Code generation in 5 languages (JS, TS, Python, Go, Rust)
- Memory retrieval (store a fact, retrieve it 3 turns later)
- Multi-step tool use (search → fetch → summarise)
- Swarm coordination (assign a task, verify all agents complete it)
- Self-healing (break a component, verify agent detects and fixes it)

Run the eval harness on every release tag and publish results to the GitHub release notes.

---

## 11. DEVELOPER EXPERIENCE

### 11.1 Missing: Hot Reload for Extension Development

**Current state:** When developing the TypeScript extension (`assets/extensions/subagents/src/`), you must restart the TUI to see changes. There is no watch mode.

**Exact fix:**
```json
// package.json
{
  "scripts": {
    "dev:extension": "tsc --watch --noEmit && node bin/cli.js",
    "dev:web": "cd assets/web/client && npm run dev"
  }
}
```
The extension itself can't hot-reload (it's injected into the Pi agent runtime), but type errors can be caught in watch mode without restarting.

### 11.2 Missing: `custom-pi doctor` Command

**Current state:** When users have setup issues (missing Pi API key, wrong Node version, Playwright not installed), they get cryptic errors.

**Exact fix:**
```
custom-pi doctor
  ✓ Node.js 22.4.0 (>= 18.0.0)
  ✓ PI_API_KEY is set
  ✓ ~/.pi/agent/ exists
  ✓ SQLite database is readable
  ✓ Playwright Chromium is installed
  ✗ LM Studio not detected at http://localhost:1234
    → Start LM Studio or set LM_STUDIO_URL in .env
  ✗ PI_API_KEY appears invalid (test request failed with 401)
    → Get a new key at https://pi.ai
```
This eliminates 80% of support issues.

### 11.3 Missing: `custom-pi init` Interactive Setup

**Current state:** First-time setup requires manually editing `.env`, `models.json`, and `settings.json`.

**Exact fix:** Add an interactive setup wizard:
```
custom-pi init
  ? Which AI provider do you want to use?
    ► Local (LM Studio / Ollama) — Free, private
      Cloud (OpenAI / Anthropic / Google) — Requires API key
  ? LM Studio URL: http://localhost:1234
  ? Which model? (auto-detected: gemma-4-e4b, llama-3.1-8b)
    ► gemma-4-e4b
  → Writing ~/.pi/agent/models.json...
  → Writing ~/.pi/agent/settings.json...
  ✓ Setup complete! Run: custom-pi
```

### 11.4 `postinstall` Script — Silent Failure

**File:** `scripts/postinstall.js`
**Current state:** The postinstall script syncs assets to `~/.pi/agent/`. If it fails (e.g., permission error), npm shows a generic warning and proceeds. The user has a broken install.

**Exact fix:** Make postinstall failures loud:
```javascript
try {
  syncAssets();
  console.log('✓ custom-pi: assets synced to ~/.pi/agent/');
} catch (err) {
  console.error(`✗ custom-pi postinstall failed: ${err.message}`);
  console.error('Try: sudo npm install -g custom-pi');
  process.exit(1); // ← Cause npm install to fail loudly
}
```

---

## 12. AI/ML INTELLIGENCE LAYER

### 12.1 Model Router — Missing Fallback Chain

**Current state:** `lib/model-router.mjs` selects the best model based on historical performance, but if the selected model is unavailable (API down, quota exceeded), the request fails.

**Exact fix:** Implement a fallback chain:
```javascript
const fallbackChain = [
  bestModel,
  ...getAllModels().sort(by('successRate')).filter(m => m.id !== bestModel.id)
];
for (const model of fallbackChain) {
  try {
    return await callModel(model, prompt);
  } catch (err) {
    logger.warn(`Model ${model.id} failed, trying next fallback`);
  }
}
throw new Error('All models in fallback chain failed');
```

### 12.2 Theory of Mind — User Expertise Model Not Persisted

**Current state:** The `Theory of Mind` subsystem maintains a dynamic user model (expertise level, emotional state, communication style, trust calibration). This model is in-memory and resets on every session start.

**Exact fix:** Persist the user model to SQLite:
```sql
CREATE TABLE IF NOT EXISTS user_model (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```
Load it on session start, update it continuously, persist on session end. The user model should improve with every interaction.

### 12.3 Metacognition — Strategy Selection Not Logged

**Current state:** The metacognition subsystem selects a thinking strategy (CoT, ToT, ReAct, Reflexion) per task but doesn't log which strategy was selected or why.

**Exact fix:** Emit a structured event to the event bus:
```typescript
eventBus.emit('metacognition.strategy_selected', {
  task: taskSummary,
  strategy: selectedStrategy,
  reasoning: rationale,
  confidence: confidenceScore,
  alternatives: otherStrategiesConsidered
});
```
This data feeds back into the eval harness to measure which strategies work best for which task types.

### 12.4 Causal Reasoner — Counterfactual Evaluation Not Exposed

**Current state:** The Causal Reasoner can evaluate "what if we used X instead of Y?" but this capability is only accessible via the `causal_analyze` tool in agent conversations. It's not surfaced in the Web UI.

**Exact fix:** Add a "What-If Explorer" panel to the Web UI. User types a counterfactual hypothesis ("what if we had used TypeScript from the start?"). The panel sends it to `POST /api/causal/counterfactual`, displays the causal graph, and shows the predicted outcome vs. the actual outcome.

### 12.5 Missing: Prompt A/B Testing Infrastructure

**Current state:** Prompts were extracted to `prompts/` directory (30+ prompts) but there is no A/B testing infrastructure to compare prompt variants.

**Exact fix:** Add a prompt experiment system:
```javascript
// prompts/experiments.json
{
  "system-identity": {
    "control": "prompts/system/identity.json",
    "variant_a": "prompts/system/identity-v2.json",
    "traffic_split": { "control": 0.5, "variant_a": 0.5 }
  }
}
```
Log which variant was used for each session. After 100+ sessions, compare task completion rate, user satisfaction, and token cost. This is the kind of infrastructure that separates good AI products from great ones.

---

## 13. SOCIAL MEDIA & MEDIA PIPELINE

### 13.1 Playwright Social Posting — No Retry on Transient Failures

**Current state:** If a Twitter/Reddit post fails due to a transient network error during the Playwright browser automation, the entire workflow fails.

**Exact fix:** Add exponential backoff retry wrapping the Playwright operations:
```typescript
async function postWithRetry(platform: string, fn: () => Promise<void>, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      logger.warn(`${platform} post failed (attempt ${attempt}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}
```

### 13.2 Image Generation — Pollinations.ai is a Single Point of Failure

**Current state:** The free image generation defaults to Pollinations.ai. If Pollinations.ai goes down, all free image generation fails.

**Exact fix:** Add alternative free providers as fallbacks:
```typescript
const FREE_PROVIDERS = [
  { name: 'pollinations', url: 'https://image.pollinations.ai/prompt/{prompt}' },
  { name: 'lexica',       url: 'https://lexica.art/api/v0/search?q={prompt}' },
  // Add others as they become available
];
// Try each in order, return first success
```

### 13.3 `request_asset_selection` — Modal Not Accessible from TUI

**Current state:** The asset selection modal (user picks one of 4 generated images) is a React component in the Web UI. If the user is running only the TUI (`custom-pi` without `custom-pi-web`), they can't select an image and the workflow hangs.

**Exact fix:** Add a TUI fallback for asset selection:
```
Agent generated 4 images. Select one:
  [1] asset_171234_0.png
  [2] asset_171234_1.png
  [3] asset_171234_2.png
  [4] asset_171234_3.png
  [0] Skip / use none
Enter choice:
```
Use the same readline-based input as the rest of the TUI.

### 13.4 Social Bridge — Missing `x-api-key` Documentation

**File:** `assets/web/social-bridge.mjs`
**Current state:** AGENT.md notes the social bridge requires `x-api-key`. There is no documentation on where to get this key or what it authenticates.

**Exact fix:** The `x-api-key` appears to be the user's own configured API key (same as `PI_API_KEY`). Clarify this in `.env.example` and in the Web UI's Social Accounts panel. Also add a connection test button: "Test Connection" that verifies the key before attempting a post.

---

## 14. VOICE & TTS

### 14.1 Kokoro TTS Server — Startup Not Managed by `custom-pi`

**Current state:** The `tts_server/` directory contains the Kokoro TTS server, but it must be started manually. There is no integration with the `custom-pi` process lifecycle.

**Exact fix:** Add TTS server management to the daemon:
```typescript
// In daemon.ts
async function startTtsServer() {
  const ttsProcess = spawn('python', ['-m', 'tts_server'], { cwd: TTS_SERVER_DIR });
  // Health check: GET http://localhost:8880/health
  // Register with daemon for lifecycle management
}
```
Add a `--no-tts` flag to `custom-pi` for users who don't want voice features.

### 14.2 STT — No Language Selection

**Current state:** The Web UI Voice Agent has voice selection (male/female presets) but no language selection for STT (speech-to-text). It presumably defaults to English.

**Exact fix:** Add a language dropdown to the Voice Agent panel. The underlying STT engine (likely `whisper` or a browser-native API) supports 99 languages. Expose the selection, persist it in `settings.json`.

### 14.3 Edge-TTS — No Offline Fallback

**Current state:** `text_to_speech` uses Edge-TTS CLI, which requires an internet connection to Microsoft's TTS service. If the user is offline, the TTS tool fails silently.

**Exact fix:** Add `piper` as an offline TTS fallback (it runs entirely locally with small neural TTS models):
```typescript
async function synthesize(text: string): Promise<Buffer> {
  try {
    return await edgeTts(text);
  } catch {
    logger.warn('Edge-TTS unavailable, falling back to piper');
    return await piperTts(text);
  }
}
```

---

## 15. DESKTOP APPLICATION — WINDOWS / LINUX / MACOS

This is the big one. The PI_IMP_PLAN.md mentions this as item #33 (P3 Low). It should be P0 for user adoption.

### 15.1 Why a Desktop App

custom-pi currently requires users to:
1. Install Node.js 18+
2. `npm install -g custom-pi`
3. Manually start `custom-pi-web` in a separate terminal for the Web UI
4. Manage two separate processes
5. Deal with npm permission issues on Linux/macOS

A desktop application eliminates all of these friction points with a single downloadable installer.

### 15.2 Technology Choice: Tauri (Recommended over Electron)

| Criterion | Tauri | Electron |
|---|---|---|
| Bundle size | ~8-15 MB | ~80-150 MB |
| Memory usage | ~50-100 MB | ~200-400 MB |
| Startup time | < 1 second | 2-5 seconds |
| Cross-platform | ✓ Win/Mac/Linux | ✓ Win/Mac/Linux |
| Native features | ✓ System tray, notifications | ✓ |
| Existing Node.js code | Requires Rust backend wrapper | Direct, no changes needed |
| Complexity | Medium | Low |

**Verdict:** Tauri for production (smaller, faster). However, since the existing backend is 100% Node.js, the quickest path to a working desktop app is Electron. Ship Electron v1 for speed, migrate to Tauri v2 for performance.

### 15.3 Electron Architecture

```
custom-pi-desktop/
├── electron/
│   ├── main.ts              # Main process — spawns Fastify server, manages window
│   ├── preload.ts           # Exposes safe IPC to renderer
│   └── tray.ts              # System tray icon and context menu
├── src/                     # Reuse existing React frontend as-is
│   └── (symlink to assets/web/client/src)
├── package.json
└── electron-builder.yml     # Packaging config for Win/Mac/Linux
```

**Main process (`electron/main.ts`):**
```typescript
import { app, BrowserWindow, Tray, Menu } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

let apiServer: ChildProcess;
let mainWindow: BrowserWindow;
let tray: Tray;

app.whenReady().then(async () => {
  // 1. Start the Fastify backend as a child process
  apiServer = spawn(process.execPath, [path.join(__dirname, '../bin/web.js')], {
    env: { ...process.env, PORT: '4321', ELECTRON_MODE: 'true' }
  });

  // 2. Wait for server to be ready
  await waitForServer('http://localhost:4321/api/health');

  // 3. Create the main browser window
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset', // macOS native traffic lights
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });

  mainWindow.loadURL('http://localhost:4321');

  // 4. System tray
  tray = new Tray(path.join(__dirname, '../assets/tray-icon.png'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Custom-PI', click: () => mainWindow.show() },
    { label: 'Launch TUI', click: () => launchTui() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
});

app.on('before-quit', () => {
  apiServer?.kill('SIGTERM');
});
```

### 15.4 Build & Distribution

**`electron-builder.yml`:**
```yaml
appId: ai.custom-pi.desktop
productName: Custom-PI
directories:
  output: dist-electron
files:
  - electron/
  - bin/
  - assets/web/
  - node_modules/
win:
  target: [nsis, portable]
  icon: assets/icon.ico
  certificateFile: ${{ secrets.WIN_CERT }}
mac:
  target: [dmg, zip]
  icon: assets/icon.icns
  category: public.app-category.developer-tools
  hardenedRuntime: true
  entitlements: electron/entitlements.mac.plist
  notarize:
    teamId: ${{ secrets.APPLE_TEAM_ID }}
linux:
  target: [AppImage, deb, rpm, snap]
  icon: assets/icon.png
  category: Development
```

**GitHub Actions — Automated Builds:**
```yaml
# .github/workflows/desktop-release.yml
name: Desktop Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install
      - run: npm run build:electron
      - uses: actions/upload-artifact@v4
        with:
          name: custom-pi-${{ matrix.os }}
          path: dist-electron/
```

### 15.5 Desktop-Specific Features

Once packaged as a desktop app, these native features become possible:

**Auto-updater:** Using `electron-updater` with GitHub Releases as the update server. Users get one-click updates without needing npm.

**Native OS notifications:** Replace the Web UI toast system with native OS notifications for swarm completion, email arrival, and security alerts:
```typescript
new Notification({ title: 'Swarm Complete', body: 'Social Media Manager finished 3 posts' }).show();
```

**System tray agent:** The agent can run "headless" with the window closed, continuing to work in the background. The tray icon shows a spinner when the agent is active.

**Deep links:** `custompì://chat?prompt=fix+my+tests` opens the app from any browser link.

**File associations:** Associate `.dag-config.yaml` files with Custom-PI so double-clicking opens the swarm configurator.

**Global keyboard shortcut:** Register `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) system-wide to show/hide the Custom-PI window from anywhere.

**Drag-and-drop files:** Drag any file from the file manager into the Chat panel to attach it to the agent conversation.

### 15.6 TUI in Desktop App

The existing TUI (`custom-pi` binary) can be embedded in the desktop app as an embedded terminal:

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

// Render the existing TUI inside the Electron window
const term = new Terminal({ theme: { background: '#0d0d1a', foreground: '#00d7ff' } });
const pty = require('node-pty').spawn(process.execPath, ['bin/cli.js'], { cols: 80, rows: 40 });
pty.onData(data => term.write(data));
term.onData(data => pty.write(data));
```

This gives users both the full Web UI and the TUI inside a single desktop application, switchable via tabs.

### 15.7 Package Manager Shortcuts

For macOS: publish to Homebrew:
```ruby
# homebrew-custom-pi/Formula/custom-pi.rb
class CustomPi < Formula
  desc "Autonomous AI coding agent with swarm intelligence"
  homepage "https://custom-pi-ai.vercel.app"
  url "https://github.com/IamNishant51/Custom-PI/releases/download/v1.11.0/custom-pi-macos.tar.gz"
  # ...
end
```

For Windows: publish to winget and chocolatey.
For Linux: publish to Snap Store (already in `electron-builder.yml`).

---

## 16. DOCUMENTATION

### 16.1 Missing: Architecture Decision Records (ADRs)

**Current state:** AGENT.md is excellent for coding conventions but doesn't explain *why* certain architectural decisions were made.

**Exact fix:** Create `docs/adr/` with ADRs for major decisions:
- ADR-001: Why SQLite instead of PostgreSQL
- ADR-002: Why Fastify instead of Express
- ADR-003: Why Pi Coding Agent instead of raw LLM API
- ADR-004: Why Playwright for social posting instead of official APIs
- ADR-005: Why the monorepo structure (not separate packages)

### 16.2 Missing: API Reference Documentation

**Current state:** Swagger UI is at `/docs` but only covers endpoints that have schema validation added (16 of 80+).

**Exact fix:** Add Fastify JSON Schema to ALL routes. The Swagger UI then auto-generates complete documentation. Include example request/response bodies for every endpoint.

### 16.3 Missing: Plugin Development Guide

**Current state:** A Plugin Marketplace exists and plugins can be installed from npm/GitHub. There is no guide on how to *write* a plugin.

**Exact fix:** Create `docs/plugin-sdk.md`:
```markdown
# Writing a Custom-PI Plugin
## Plugin Structure
## Available Hook Points
## Accessing the Tool Registry
## Persisting Plugin State (SQLite)
## Publishing Your Plugin
```
Also publish `@custom-pi/plugin-sdk` to npm with TypeScript types for the plugin context.

### 16.4 SOUL.md — The Identity Layer

**Current state:** `SOUL.md` defines the agent's identity but is only mentioned in passing in AGENT.md. Users don't know they can customise it.

**Exact fix:** Add a "Personalise Your Agent" section to the README explaining:
- What SOUL.md is
- What fields are customisable (name, personality, values, communication style)
- Example: change `Hermes` to your own agent name
- How SYSTEM.md interacts with SOUL.md

---

## 17. PRIORITISED BACKLOG

### TIER 0 — Ship This Week (Correctness / Safety)

| # | Item | File(s) | Effort |
|---|---|---|---|
| T0-1 | Fix `withSwarmLock` missing `finally` (deadlock bug) | `web-server.mjs:315` | 5 min |
| T0-2 | Self-Modifier approval gate | `evolution/self-modifier.ts` | 4 hrs |
| T0-3 | Webhook event deduplication | `routes/webhooks.mjs` | 2 hrs |
| T0-4 | Turn on `undo-redo` and `notification-center` feature flags | `.feature-flags.json` | 5 min |
| T0-5 | Plugin Worker Thread sandbox | `lib/plugin-system.mjs` | 6 hrs |
| T0-6 | `postinstall` script — loud failure on error | `scripts/postinstall.js` | 30 min |

### TIER 1 — Ship This Month (Architecture)

| # | Item | File(s) | Effort |
|---|---|---|---|
| T1-1 | Split social routes out of `web-server.mjs` | `routes/social/` | 1 day |
| T1-2 | Extract `index.ts` tools into per-tool files | `tools/` | 3 days |
| T1-3 | `custom-pi doctor` command | `bin/cli.js` | 1 day |
| T1-4 | `custom-pi init` interactive setup | `bin/cli.js` | 1 day |
| T1-5 | Enable `noUnusedLocals` in tsconfig | `tsconfig.json` | 2 hrs |
| T1-6 | SQLite WAL mode pragma | `state-db.ts` | 30 min |
| T1-7 | Document persistence to backend (away from localStorage) | `routes/documents.mjs` | 4 hrs |
| T1-8 | `sqlite-vss` for dense vector search | `state-db.ts` | 1 day |
| T1-9 | Three.js tree-shaking | `panels/VoiceAgentPanel.tsx` | 3 hrs |
| T1-10 | Migrate remaining 5 panels to React Router | `App.tsx` + 5 panel files | 4 hrs |

### TIER 2 — Ship Next Quarter (Desktop App + Intelligence)

| # | Item | Effort |
|---|---|---|
| T2-1 | Electron desktop app (Win/Mac/Linux) | 2 weeks |
| T2-2 | GitHub Actions auto-build for all platforms | 2 days |
| T2-3 | Homebrew formula + winget manifest | 1 day |
| T2-4 | Model fallback chain | 4 hrs |
| T2-5 | Persist Theory of Mind user model to SQLite | 4 hrs |
| T2-6 | Prompt A/B testing infrastructure | 3 days |
| T2-7 | TUI session history navigation (Ctrl+H) | 1 day |
| T2-8 | TUI multi-pane layout (Ctrl+B) | 2 days |
| T2-9 | Offline TTS fallback with `piper` | 4 hrs |
| T2-10 | Lighthouse CI integration | 2 hrs |

### TIER 3 — Future Vision

| # | Item |
|---|---|
| T3-1 | Multi-user collaboration with WebRTC presence |
| T3-2 | LoRA fine-tuning pipeline on user corrections |
| T3-3 | Wake-word detection ("Hey Custom-PI") |
| T3-4 | `@custom-pi/plugin-sdk` npm package |
| T3-5 | Helm chart for Kubernetes deployment |
| T3-6 | Causal Reasoner "What-If Explorer" Web UI panel |
| T3-7 | Native mobile app (iOS/Android) using Capacitor |

---

## CLOSING NOTES FROM THE AUDITOR

custom-pi is genuinely one of the most ambitious solo open-source AI agent projects shipping today. The feature velocity from v1.0 to v1.11.0 in three weeks is remarkable. The architecture is sound at a high level — SQLite as the single state store, Fastify for the API, React for the UI, the Pi Coding Agent as the LLM runtime — these are all good choices.

The main risks are:

1. **The `web-server.mjs` monolith and `index.ts` `@ts-nocheck`** — these will cause correctness bugs that are hard to trace as the codebase grows. Address these first.

2. **The self-modifier without approval gates** — this is the one feature that could cause irreversible harm. Gate it before you promote it.

3. **No desktop app** — the installation friction (npm, Node.js, two processes) is the biggest barrier to adoption. An Electron app removes all of it.

Everything else in this document is an improvement, not a fix. The foundation is solid. Build on it.
