# Custom-PI Comprehensive Test Results

> **Generated:** Mon Jun 22 2026
> **Project:** /home/nishant/Desktop/pi-custom-pack
> **Methodology:** Static code analysis of all frontend (React/TypeScript) components, backend (Fastify) route files, schema definitions, WebSocket implementation, and TUI framework. Cross-referenced all frontend API calls against backend routes.

---

## Executive Summary

| Category | Result |
|----------|--------|
| TypeScript compilation (`tsc --noEmit`) | ✅ **PASS** — 0 errors |
| Unit/Integration tests (`vitest run`) | ✅ **PASS** — 406 tests, 43 files |
| **Total issues found** | **❌ 78 issues** (15 critical, 22 high, 18 medium, 23 low) |
| Missing backend routes | **5** |
| Critical WebSocket bugs | **3** |
| Schema type mismatches (will cause 500s) | **5** |
| Frontend null-pointer crash risks | **4** |
| Broken/Panel-blocking features | **7 distinct features** |

---

## CRITICAL ISSUES

### 1. Missing Route: `POST /api/auth/login`

- **Frontend:** `LoginPanel.tsx:13` — `fetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) })`
- **Backend:** No route handler exists for this path anywhere in `routes/` or `web-server.mjs`
- **Impact:** The Login panel is **completely broken**. Every login attempt returns 404. User can never authenticate.
- **Fix needed:** Add route handler that validates password and creates session.

### 2. Missing Route: `POST /api/memory/search`

- **Frontend:** `MemoryPanel.tsx:47` — `fetch("/api/memory/search", { method: "POST", body: { query, type?, project? } })`
- **Backend:** Only exists as WebSocket message type (`websocket.mjs:148`) and agent tool (`tools.mjs:100`). No HTTP endpoint.
- **Impact:** Memory search panel **completely broken**. Users cannot search memories from the Web UI.
- **Fix needed:** Add HTTP route handler for `POST /api/memory/search`.

### 3. Missing Route: `POST /api/memory/store`

- **Frontend:** `MemoryPanel.tsx:65` — `fetch("/api/memory/store", { method: "POST", body: { content, type?, ... } })`
- **Backend:** Only exists as an agent tool. No HTTP endpoint.
- **Impact:** Memory store panel **completely broken**. Users cannot save new memories from the Web UI.
- **Fix needed:** Add HTTP route handler for `POST /api/memory/store`.

### 4. Missing Route: `POST /api/mcp/test`

- **Frontend:** `MCPPanel.tsx:54` — `fetch("/api/mcp/test", { method: "POST" })`
- **Backend:** Only `GET /api/mcp/config` and `POST /api/mcp/config` exist. No test endpoint.
- **Impact:** MCP "Test Connection" button always fails with 404.
- **Fix needed:** Add `POST /api/mcp/test` route that attempts to connect to the MCP server.

### 5. Missing Route: `DELETE /api/email/accounts/:id`

- **Frontend:** `EmailPanel.tsx:48` — `fetch(\`/api/email/accounts/${id}\`, { method: "DELETE" })`
- **Backend:** Only `POST /api/email/accounts` (create) and `GET /api/email/accounts` (list) exist. No delete endpoint.
- **Impact:** Users cannot delete email accounts from the UI. Delete button always fails.
- **Fix needed:** Add `DELETE /api/email/accounts/:id` route.

### 6. WebSocket: Missing `await` on `session.handleMessage()` in `"agent_chat"` handler

- **File:** `routes/websocket.mjs:138`
- **Issue:** `session.handleMessage(...)` is called without `await`. Compare with line 90 where the same method IS awaited.
- **Impact:** The returned Promise is fire-and-forget. The `try/catch` at lines 141-143 catches only synchronous errors; any async rejection becomes an **unhandled promise rejection** that could crash the process. The `"session_start"` event (line 137) is sent before the message is processed.
- **Fix needed:** Add `await` before `session.handleMessage(...)`.

### 7. WebSocket: Missing `try/catch` on 4 message-type branches

- **File:** `routes/websocket.mjs` lines 98-100, 102-108, 110-118, 120-125
- **Issue:** The `"interrupt"`, `"swarm_pause"`, `"swarm_resume"`, and `"user_answer"` handlers have no try/catch wrapping. Async throws become unhandled promise rejections.
- **Impact:** Node.js process could crash on `unhandledRejection`. Future Node.js versions terminate the process on unhandled rejections.
- **Fix needed:** Add try/catch around each branch, or (better) a single top-level try/catch around the entire message dispatch.

### 8. WebSocket: Shared global `session` races across concurrent connections

- **File:** `routes/websocket.mjs:25,90` → `web-server.mjs:2654`
- **Issue:** A single global `session` object is shared across ALL WebSocket connections. Two concurrent `"chat"` messages will race on `session.messages.push()` because `handleMessage` has multiple async yield points. No mutex/lock is used.
- **Impact:** Concurrent users corrupt each other's conversation history. Messages get interleaved in the `session.messages` array. This is a data race.
- **Fix needed:** Either create a unique session per connection, or add a mutex around `session.handleMessage()`.

### 9. Frontend: `Dashboard.tsx` — Single `Promise.all` fails all 8 data fetches on any single error

- **File:** `components/Dashboard.tsx:19-48`
- **Issue:** Two `Promise.all` calls run 8 parallel fetches. If **any one** endpoint returns non-2xx, `response.json()` throws, and **all 8 datasets are lost**. The entire dashboard shows "Failed to load" even if only 1 of 8 APIs failed. Additionally, no `response.ok` check is done before calling `.json()` — on 4xx/5xx the response body may not be JSON.
- **Impact:** The entire Dashboard panel shows an error state if any single API (e.g., vault/health) is down, even when all others work fine.
- **Fix needed:** Wrap each fetch individually, or use `Promise.allSettled()` with per-endpoint error handling.

### 10. Frontend: `Dashboard.tsx` — `p.action.toUpperCase()` crashes on undefined action

- **File:** `components/Dashboard.tsx:242`
- **Issue:** `{p.action.toUpperCase()}` renders in the work products list. If `p.action` is `undefined` or `null`, `.toUpperCase()` throws `TypeError`. The data comes from `/api/work-products` which could return unexpected data.
- **Impact:** One bad work product entry crashes the entire Dashboard panel rendering, triggering the app-level ErrorBoundary and hiding ALL content.
- **Fix needed:** Use `{(p.action || "").toUpperCase()}` or a fallback string.

### 11. Frontend: `MCPPanel.tsx` — `save()` ignores HTTP errors, shows false success

- **File:** `components/MCPPanel.tsx:41-49`
- **Issue:** The `save()` function calls `fetch("/api/mcp/config", ...)` but **never checks `res.ok`**. Even on 4xx/5xx, it shows "MCP configuration saved" toast and clears the dirty flag. User sees no indication the save failed and cannot retry.
- **Impact:** Users believe their MCP configuration was saved when it wasn't. Data loss scenario.
- **Fix needed:** Check `res.ok` before showing success toast.

### 12. Schema: `DELETE /api/social/queue/:id` — Wrong property name (`success` vs `ok`)

- **File:** `routes/social.mjs:649`
- **Schema declares:** `{ success: { type: "boolean" } }`
- **Handler returns:** `{ ok: false, error: "..." }` or `{ ok: true, message: "..." }`
- **Impact:** With Fastify's response serialization, the client receives `{ "success": undefined }` instead of `{ "ok": true }`. The frontend checks `d.ok` so it will always see failure and toast "Failed to cancel scheduled post".
- **Fix needed:** Change schema property from `success` to `ok`.

### 13. Schema: `POST /api/vault/get` — Type mismatch (null vs string)

- **File:** `routes/vault-contacts.mjs:28`
- **Schema declares:** `value: { type: "string" }`
- **Handler returns:** `{ ok: false, value: null }` on key not found (line 38)
- **Impact:** `null` is not of type `string`. Fastify may reject this with a 500 error or strip the response.
- **Fix needed:** Add `nullable: true` to the `value` property schema.

### 14. Schema: `GET /api/undo/last` — Type mismatch (null vs object)

- **File:** `routes/undo-redo.mjs:71`
- **Schema declares:** `action: { type: "object" }`
- **Handler returns:** `{ ok: false, action: null }` when no undo history (lines 73, 76)
- **Impact:** `null` is not type `object`. Fastify may reject with 500.
- **Fix needed:** Add `nullable: true` to the `action` property schema.

### 15. Schema: `GET /api/pipeline/status` — Type mismatch (null vs object)

- **File:** `routes/health.mjs:55`
- **Schema declares:** `current: { type: "object" }`
- **Handler returns:** `data.current` which is `null` when no active deployment
- **Impact:** Same null vs object issue. Could cause 500.
- **Fix needed:** Add `nullable: true` to the `current` property schema.

---

## HIGH ISSUES

### 16. Schema: `GET /api/budget/forecast` — Type mismatch (null vs object)
- **File:** `routes/budget.mjs:19`
- **Issue:** `alert: { type: "object" }` but handler returns `alert = null` when no alert conditions exist.
- **Fix:** Add `nullable: true`.

### 17-33. Schema: 17 Routes Missing Response Schemas Entirely
All routes in `routes/social.mjs` for Bluesky, Discord, Telegram configure/disconnect/post, publish, queue, drafts approve/reject, autonomous/tick — plus `POST /api/gallery/upload`, `POST /api/models/vote` — have **no response schema at all**. Fastify cannot validate or document these responses.

### 34. Frontend: `SubAgentPanel.tsx` — Stale closure on resize handlers saves pre-drag values
- **File:** `components/SubAgentPanel.tsx:291-292, 315-317`
- **Issue:** `localStorage.setItem("subagent-lcw", leftColW)` in the `onUp` callback captures `leftColW` from the closure at the time the callback was created, NOT the current drag position. On page reload, the pane position reverts to pre-drag state.
- **Fix:** Use a ref for `leftColW` that always holds the latest value.

### 35. Frontend: `ChatView.tsx` — No `reader.onerror` handler; `reader.result as string` produces `"null"`
- **File:** `components/ChatView.tsx:229-246`
- **Issue:** When `FileReader` fails (corrupted file, permissions), `reader.result` is `null`. The `as string` assertion does not guard at runtime. Failed reads produce garbage `data: "null"` attachments.
- **Fix:** Add `reader.onerror` handler and reject the file. Also fix binary file handling (`.zip`, `.pdf` should not be read as text).

### 36. Frontend: `SocialPanel.tsx` — `new Date("").getTime()` returns `NaN`
- **File:** `components/SocialPanel.tsx:169`
- **Issue:** When `scheduleTime` is empty string `""` (default state), `new Date("").getTime()` returns `NaN`. This sends `NaN` as the `scheduled_at` timestamp to the server.
- **Fix:** Add validation before the `new Date()` call.

### 37. Frontend: `SocialPanel.tsx` — `setTimeout` not cleaned up on unmount
- **File:** `components/SocialPanel.tsx:139, 183`
- **Issue:** Two `setTimeout` calls (1.2s and 2s) are never cleared on component unmount. React 18 logs warnings for state updates on unmounted components.
- **Fix:** Store timeout IDs in a ref and clear in the useEffect cleanup return.

### 38. Frontend: `App.tsx` — Single ErrorBoundary covers entire app
- **File:** `components/App.tsx:182`
- **Issue:** A single `<ErrorBoundary>` wraps the entire `<AppContent>`. If any panel crashes (e.g., null reference in Dashboard, bad data in SocialPanel), the entire app shows "Something went wrong", not just that panel.
- **Fix:** Wrap each route in its own ErrorBoundary.

### 39. WebSocket: `session.messages` grows unboundedly — no trim/cap
- **File:** `web-server.mjs:2672,2736`
- **Issue:** Every `handleMessage` call pushes user message + model response to `session.messages`. There is no trimming, sliding window, or length cap. Over hours/days, this can consume gigabytes.
- **Fix:** Cap `session.messages` to the last N messages (e.g., 200).

### 40. WebSocket: `pendingQuestions` entries never cleaned up on disconnect
- **File:** `routes/websocket.mjs:60-64`
- **Issue:** The `"close"` handler does not clean up `pendingQuestions` entries. If a user disconnects while a question is pending, the entry leaks forever.
- **Fix:** Iterate `pendingQuestions` and reject/resolve all on socket close.

### 41. Frontend: `SettingsPanel.tsx` — POST `/api/models/check` error handling
- **File:** `components/SettingsPanel.tsx:53`
- **Issue:** The "Auto-Detect Local Models" button sends `POST /api/models/check` without body. The response format may not match what the frontend expects. No loading state on the button.
- **Fix:** Add response validation and loading/disabled state.

### 42. Frontend: `ChatView.tsx` — Direct DOM mutation via `setTimeout` desyncs with React
- **File:** `components/ChatView.tsx:203-211`
- **Issue:** `handleCopyClick` directly mutates `target.innerText` and `target.classList` with a 2s timeout. If React re-renders during the 2s window, virtual DOM and real DOM diverge. The "Copied!" text persists indefinitely or gets overwritten.
- **Fix:** Use React state instead of DOM mutation.

### 43. Schema: All 44 array properties missing `items` definitions
- **Systematic issue across all route files.**
- **Impact:** In strict JSON Schema mode, arrays cannot be validated. Swagger UI cannot document element structure. Responses with empty arrays may be handled incorrectly.
- **Fix:** Add `items` to every array type.

---

## MEDIUM ISSUES

### 44. WebSocket: Empty catch blocks throughout (no logging)
- **File:** `routes/websocket.mjs` — at least 21 empty `catch {}` blocks
- **Impact:** Silent failures make production debugging nearly impossible.

### 45. WebSocket: Socket not added to `swarmSockets` when no swarm state exists
- **File:** `routes/websocket.mjs:48-50`
- **Impact:** If a user connects when no swarm is running, their socket never receives swarm broadcasts.

### 46. WebSocket: No rate limiting on WebSocket messages
- **File:** `routes/websocket.mjs`
- **Impact:** Client can send thousands of `"chat"` messages per second.

### 47. WebSocket: Error messages leak internal details
- **File:** `routes/websocket.mjs:94,142,150,156`
- **Impact:** Raw exception messages sent to WebSocket clients.

### 48. Frontend: SubAgentPanel `activeGoal` dep churn
- **File:** `components/SubAgentPanel.tsx:188-189`

### 49. Frontend: SubAgentPanel timer continues during pause
- **File:** `components/SubAgentPanel.tsx:60-66`

### 50. Frontend: MCPPanel no loading state on test button
- **File:** `components/MCPPanel.tsx:51-64`

### 51. Frontend: SocialPanel missing useEffect dep
- **File:** `components/SocialPanel.tsx:109`

### 52. Backend: CORS restricted to localhost:4322
- **File:** `web-server.mjs:3832-3843`

### 53. Backend: CSP not configurable
- **File:** `web-server.mjs:3820-3828`

### 54. Backend: No global request body size limit
- **File:** `web-server.mjs`

### 55. Schema: GET /api/social/email/status missing response schema
- **File:** `routes/social.mjs:499`

### 56. Schema: No error code response schemas (systematic)
- **All route files** — 0 routes define 4xx/5xx response schemas

### 57. ChatView: alert() instead of showToast()
- **File:** `components/ChatView.tsx:226`

---

## LOW ISSUES / OBSERVATIONS

### 58-78. Remaining low-severity items (see full details below)

| # | Issue | File | Severity |
|---|-------|------|----------|
| 58 | `alert()` used instead of `showToast()` | ChatView.tsx:226 | Low |
| 59 | `vaultHealthData.ok` assumed | Dashboard.tsx:43 | Low |
| 60 | `getCurrentSwarmState()` without lock | websocket.mjs:133 | Low |
| 61 | Sequential `if` not `switch` | websocket.mjs:76-234 | Low |
| 62 | Unknown WS types silently ignored | websocket.mjs | Low |
| 63 | `session_start` sent before processing | websocket.mjs:88 | Low |
| 64 | No interrupt confirmation to client | websocket.mjs:98-100 | Low |
| 65 | Missing return after handlers | websocket.mjs:96,146 | Low |
| 66 | handleMessage 600+ lines deep | web-server.mjs:2654 | Low |
| 67 | Hardcoded validViews (27 entries) | App.tsx:167 | Low |
| 68 | No additionalProperties on notes | notes-tasks-reminders.mjs:43 | Low |
| 69 | camelCase vs snake_case inconsistency | multiple files | Low |
| 70 | Error handler logs full stacks | web-server.mjs:3717 | Low |
| 71 | Large session history over WS | websocket.mjs | Low |
| 72 | No client WS health check | websocket.mjs | Low |
| 73 | TUI tests: only 3 (color utils) | tui-colors.test.ts | Low |
| 74 | Zero tests for 172 HTTP routes | — | Low |
| 75 | Zero e2e tests for web UI | — | Low |
| 76 | GET vs POST email/fetch ambiguity | web-server.mjs:4257 | Low |
| 77 | No parameterized social disconnect | social.mjs | Low |
| 78 | No maxMessages validation on email fetch | email.mjs:30 | Low |

---

## FEATURE COVERAGE SUMMARY

### Web UI (28 Panels)

| Panel | Route | Status | Key Issue |
|-------|-------|--------|-----------|
| Login | `/login` | ❌ **Broken** | POST /api/auth/login missing |
| Chat | `/chat` | ⚠️ Partial | FileReader, DOM mutation |
| Dashboard | `/dashboard` | ❌ **Broken** | Promise.all crash, undefined crash |
| Secrets Vault | `/vault` | ⚠️ Partial | null type mismatch |
| Budget | `/budget` | ✅ OK | Minor alert null |
| Voice Agent | `/voice` | ⚠️ Partial | Untested WS voice stream |
| Memory | `/memory` | ❌ **Broken** | search + store routes missing |
| Knowledge Graph | `/knowledge-graph` | ✅ OK | |
| Pipeline | `/pipeline` | ⚠️ Partial | null type mismatch |
| Health | `/health` | ✅ OK | |
| Work Products | `/work-products` | ✅ OK | |
| Sub-Agents | `/agents` | ⚠️ Partial | 3 critical WS bugs, stale closure |
| Agent Discovery | `/agent-discovery` | ✅ OK | |
| MCP Servers | `/mcp` | ❌ **Broken** | test route missing, false save |
| Teams | `/teams` | ✅ OK | |
| Settings | `/settings` | ✅ OK | |
| Social Accounts | `/social` | ⚠️ Partial | NaN timestamp, unmount leaks |
| Notes & Tasks | `/notes` | ✅ OK | |
| Contacts | `/contacts` | ✅ OK | |
| Model Cookbook | `/cookbook` | ✅ OK | |
| Deep Research | `/research` | ✅ OK | |
| Model Comparison | `/compare` | ✅ OK | |
| Image Gallery | `/gallery` | ✅ OK | |
| Documents | `/documents` | ✅ OK | |
| Email | `/email` | ❌ **Broken** | DELETE account route missing |
| Canvas Editor | `/canvas-editor` | ✅ OK | |
| Theme Editor | `/theme` | ✅ OK | |
| Admin | `/admin` | ✅ OK | |

### TUI — All features ✅ (but only 3 tests for color utilities)

### Backend API (172 routes + 2 WS)

| Aspect | Status |
|--------|--------|
| Route coverage | ⚠️ 5 critical missing routes |
| Body schemas | ⚠️ 44 arrays missing items; 5 null type mismatches |
| Response schemas | ⚠️ 17 routes missing entirely |
| Error schemas | ❌ 0 routes have 4xx/5xx schemas |
| WebSocket | ❌ 3 critical bugs |
| Rate limiting | ⚠️ Not on WebSocket |
| Security | ✅ Headers, Auth, CORS (partial) |

---

## Top Recommendations (by impact)

### Immediate (blocking features):
1. Add `POST /api/auth/login` route
2. Add `POST /api/memory/search` and `POST /api/memory/store` routes
3. Add `POST /api/mcp/test` route
4. Add `DELETE /api/email/accounts/:id` route
5. Fix `DELETE /api/social/queue/:id` schema: `success` → `ok`
6. Add `nullable: true` to 5 schema properties returning null

### High (reliability):
7. Add `await` on websocket.mjs:138
8. Add top-level try/catch in WS message handler
9. Refactor Dashboard Promise.all → allSettled
10. Add null guard on Dashboard.tsx:242
11. Fix MCPPanel.tsx save → check res.ok
12. Fix SubAgentPanel.tsx stale closure

### Medium (correctness):
13. Add `items` to 44 array schemas
14. Fix timer on pause in SubAgentPanel
15. Clean up setTimeout in SocialPanel
16. Rate-limit WebSocket connections
17. Clean up pendingQuestions on WS disconnect
18. Cap session.messages (last N)

### Low (polish):
19. Replace alert() with showToast()
20. Per-route ErrorBoundary
21. Derive validViews from route config
22. Error response schemas for all routes
23. TUI + API test coverage
