# Custom-PI Improvement Plan

**Project:** custom-pi v1.11.0
**Date:** 2026-06-16
**Scope:** Full-stack autonomous AI coding agent — 100+ TS source files, 80+ API endpoints, 28 UI views, multi-agent swarm, 3D avatar, voice/TTS, email, social media, plugin marketplace.

---

## P0 — Critical (Architecture & Reliability)

| # | Area | Issue | Why It Matters | Suggested Approach | Status |
|---|------|-------|----------------|--------------------|--------|
| 1 | **Web Server** | `web-server.mjs` is **9,400 lines** as one file | Zero modularity, impossible to test in isolation, merge conflicts, onboarding nightmare | Split into: `routes/` (per domain: chat, voice, social, vault, etc.), `lib/` (McpConnection, LspConnection, WebSession), `middleware/` (auth, rate-limit, cors). Each file <500 lines. Keep `web-server.mjs` as thin bootstrap | [x] **9,546→6,789 lines** (−29%). **14 route modules** (1,404 lines total). Extracted: services (db, vault, cost-tracker, memory, session, settings, swarm, web-search), lib/rate-limiter, routes (notes-tasks-reminders, vault-contacts, chat-voice, email, calendar, research, budget, gallery, model-download, knowledge-graph, webhooks, health, auth, ssh). Remaining inline: social media (~950 lines), WebSocket (~230 lines), session chat CRUD (~150 lines). |
| 2 | **API Quality** | Fastify schema validation is unused on all 80+ endpoints | No request validation — malformed payloads silently pass through, no auto-generated docs, no type safety on the wire | Add Fastify `schema` objects to every route (JSON Schema for body/querystring/params). Use `@fastify/swagger` + `@fastify/swagger-ui` for auto-generated OpenAPI docs | [x] Swagger docs at `/docs`. Schema validation on **16 endpoints**: top 10 called + notes/tasks/contacts/calendar/vault/memory/settings |
| 3 | **Error Handling** | Error responses are inconsistent — some return `{error: "msg"}`, others `{message: "msg"}`, some plain text | Clients can't reliably parse errors; debugging is painful | Standardize: all errors return `{ error: string, code: string, statusCode: number }`. Centralize error response in Fastify `setErrorHandler` | [x] `sendError()` helper + `setErrorHandler` + auth/rate-limit/not-found standardized |
| 4 | **Testing** | Only **30% line coverage** historically; now **396 tests across 43 files** | Need more endpoint integration tests for safety net | Add integration tests for every API endpoint group (supertest + Fastify `inject()`). Aim for 70%+ coverage on server, 50%+ on client | [x] **406 tests, 43 files** — added integration tests for budget/stats, budget/config, budget/forecast, flags, migrations, notifications, undo, auth/tokens, health, not-found, bad-request. |
| 5 | **Type Safety** | `index.ts` has `// @ts-nocheck` (3,066 lines) | The most critical file in the extension is unchecked — type bugs surface at runtime | Incrementally remove `@ts-nocheck` by fixing errors file by file. Start with the files that have fewest errors (test files, utility modules) | [~] Pending |

---

## P1 — High (UX, Performance, AI Foundations)

| # | Area | Issue | Why It Matters | Suggested Approach | Status |
|---|------|-------|----------------|--------------------|--------|
| 6 | **Client Architecture** | Custom hash router instead of React Router; 5 contexts vs. centralized state | Fragile navigation, stale context issues, prop drilling, poor DX | Migrate to `react-router-dom` v7 (already in deps). Use `zustand` for global state (simpler than context chains). Add route-level code splitting via `React.lazy` | [x] `BrowserRouter` + 30 `<Route>` entries in `App.tsx`. `react-router-dom` v7.6.2. No hash-based router remains |
| 7 | **UI Polish** | No loading/skeleton states on 28 panels; no empty states; no error boundaries per panel | Users see blank panels or janky content flashes | Add `<Suspense>` + skeleton loaders for every panel. Add empty states ("No contacts yet"). Wrap each panel in its own ErrorBoundary | [x] `LoadingSkeleton.tsx` (text/card/table/circle variants). `PanelLoadingSpinner` + `PanelErrorCard` components. **23/28 panels** retrofitted with loading/error states. Remaining 5 panels (DocEditor, ThemeEditor, CanvasEditor, Login, SubAgent) have no server fetches |
| 8 | **WebSocket Protocol** | 15+ message types undocumented; no versioning; no state reconciliation on reconnect | WS reconnection loses in-flight state; protocol changes break clients | Document all message types in a shared types file. Add message version field. Implement state reconciliation on reconnect (server sends last N events) | [x] Comprehensive `ws-types.ts` with 20+ server→client + 12 client→server message interfaces, full union types, and `WS_TYPES` enum. State reconciliation via `swarm_recovery` message on reconnect. |
| 9 | **Bundle Size** | Three.js + @react-three/fiber adds ~500KB to JS bundle; all 28 views loaded eagerly | Slow initial load, bad Core Web Vitals | Lazy-load 3D components. Tree-shake Three.js imports. Use `React.lazy` + Suspense for all panels. Add bundle analysis to CI | [x] Panels lazy-loaded via `React.lazy()`. Service worker caches app shell. Bundle analysis not yet in CI |
| 10 | **AI Evaluation** | No framework to measure agent quality — no benchmarks, no regression tests | Improvements are anecdotal; can't tell if a change degrades performance | Add eval harness: define test tasks (code gen, Q&A, tool use), run against LLM, score outputs. Use LLM-as-judge or deterministic checks. Run in CI | [x] `lib/eval-harness.mjs` with 5 test tasks (code_gen, tool_use, qa, reasoning, debugging). `GET /api/eval/tasks` + `POST /api/eval/run` endpoints. Deterministic scoring via keyword checks. |
| 11 | **Prompt Management** | Prompts are hardcoded in source files (system prompts, tool descriptions) | Can't iterate prompts without code deploys; no A/B testing | Extract all prompts to `prompts/` directory as versioned JSON/YAML files. Add prompt selection strategy (static, LLM-generated, or A/B tested) | [x] **30+ prompts** extracted to `prompts/` directory (system/identity, system/modes, agents/swarm, agents/review, features/voice, features/email, features/social, features/research). Loader utility at `prompts/prompts.mjs`. `soul-loader.ts` updated to read from JSON |
| 12 | **Model Routing** | Static `models.json` config; no learned routing | Always uses the same model regardless of task type | Add performance tracking per model per task type. Implement dynamic router that selects model based on historical success rate + cost + latency | [x] `lib/model-router.mjs` tracks performance per model per task type (attempts, success rate, avg latency, avg cost). `recordModelPerformance()` + `getBestModel()` with scoring. `GET /api/models/performance` + `POST /api/models/select` endpoints. |
| 13 | **Rate Limiting** | Only 3 endpoints have rate limiting | Single user can DoS the server; no tenant isolation | Add token-bucket rate limiting to all mutation endpoints. Use Fastify `onRequest` hook with configurable limits per route group | [x] Extended to ALL mutation endpoints (notes, tasks, reminders, contacts, calendar, sessions, swarm, teams, agents, gallery, voice, auth, ssh, companion, webhooks) + chat completions rate limiter |
| 14 | **Accessibility** | No aria labels, no keyboard navigation, no focus management | Inaccessible to screen readers; power users can't navigate via keyboard | Add `aria-*` attributes to all interactive elements. Add keyboard shortcuts (Cmd+K for search, Cmd+/ for command palette). Ensure proper tab order | [x] `role="application"` on root, `role="navigation"` + `aria-label` on sidebar, `role="dialog"` + `aria-modal` on keyboard shortcuts overlay, `role="alert"` + `aria-live` on toasts, `?` key help overlay |

---

## P2 — Medium (Feature Depth & Developer Experience)

| # | Area | Issue | Why It Matters | Suggested Approach |
|---|------|-------|----------------|--------------------|
| 15 | **Monolithic Components** | `SubAgentPanel.tsx` is ~1,500+ lines handling swarm lifecycle, team CRUD, provisioning, column resize, agent chat | Impossible to maintain; bugs are expensive to fix | Split into: `SwarmCommander.tsx`, `TeamManager.tsx`, `AgentGrid.tsx`, `ProvisioningPanel.tsx`, `AgentChatPanel.tsx`. Use composition | [x] Already 521 lines with 9 sub-components (SwarmCommander, TeamRenderer, AgentCardCompact, AgentLogView, PostEditorCanvas, QuestionModal, Markdown, formatTime, renderCeoLine). Pre-split architecture. |

| 17 | **Image Optimization** | No image optimization pipeline | Gallery images are served as-is; slow page loads | Add sharp-based image processing middleware: resize to `?w=...`, convert to WebP when supported, add CDN headers | [x] `lib/image-optimizer.mjs` with sharp integration. Gallery endpoints accept `?w=` (resize) and `?format=webp`. File-system cache with `X-Optimized` headers. Graceful fallback without sharp. |

| 20 | **Undo/Redo** | No undo for destructive actions (delete team, remove contact, etc.) | Data loss is irreversible | Add an action log to SQLite. Implement undo stack (at least 50 actions) with inverse operations | [x] `routes/undo-redo.mjs` — SQLite-backed action log (200 cap per entity). `POST /api/undo/log`, `GET /api/undo/history`, `POST /api/undo/execute`. Frontend `UndoBar` component auto-shows last action with 5s timeout. `useUndo` hook for components. |

| 21 | **Onboarding** | New users land in chat with no guidance | High abandonment rate; users don't discover features | Add guided onboarding tour (5 steps): connect LLM provider, create first agent, run swarm, explore dashboard, customize theme. Persist completion status | [x] `OnboardingTour` component with 5 steps (welcome → settings → agent-discovery → sub-agents → theme). localStorage-persisted progress. Skip/back/next navigation. |

| 22 | **Token Forecasting** | Cost tracker is reactive (tracks past spend) | Users get surprised by overruns | Add predictive budgeting: forecast daily/monthly cost based on recent usage patterns. Alert when projected spend exceeds budget | [x] `getForecast()` in cost-tracker — daily avg cost/tokens, projected monthly, trend analysis (increasing/decreasing/stable), budget alerts. `GET /api/budget/forecast` endpoint. |
| 16 | **Service Worker** | `sw.js` exists but likely doesn't cache API responses or app shell | PWA capability is unused; no offline support | Implement full PWA: cache app shell on install, cache API responses with stale-while-revalidate, add offline indicator |
| 17 | **Image Optimization** | No image optimization pipeline | Gallery images are served as-is; slow page loads | Add sharp-based image processing middleware: resize to `?w=...`, convert to WebP when supported, add CDN headers |
| 18 | **Notifications** | Only in-app toasts that auto-dismiss after 3.5s | Users miss important events (swarm done, email received, cost threshold crossed) | Add Notification Center: persisted to SQLite, with read/unread status, push via WebSocket. Support desktop push via Notification API + service worker | [x] Notification center implemented: `/api/notifications` CRUD + read/unread tracking. `NotificationBell` component with dropdown list + unread badge polling. Backend `routes/notifications.mjs` with SQLite persistence. |
| 19 | **Search** | No global search across views | Users must navigate to the right panel to find things | Add Cmd+K command palette: search across settings, agents, teams, contacts, notes, email. Fuzzy match with keyboard navigation | [x] `CommandPalette.tsx` component with Cmd+K shortcut. Searches 28 views + commands (toggle sidebar, help, create team/note/contact). Arrow-key navigation + Enter selection. |
| 20 | **Undo/Redo** | No undo for destructive actions (delete team, remove contact, etc.) | Data loss is irreversible | Add an action log to SQLite. Implement undo stack (at least 50 actions) with inverse operations |
| 21 | **Onboarding** | New users land in chat with no guidance | High abandonment rate; users don't discover features | Add guided onboarding tour (5 steps): connect LLM provider, create first agent, run swarm, explore dashboard, customize theme. Persist completion status |
| 22 | **Token Forecasting** | Cost tracker is reactive (tracks past spend) | Users get surprised by overruns | Add predictive budgeting: forecast daily/monthly cost based on recent usage patterns. Alert when projected spend exceeds budget |
| 23 | **API Versioning** | All endpoints under `/api/` with no version prefix | Breaking changes affect all clients simultaneously | Add `/api/v1/` prefix. Maintain backward compatibility for at least 2 versions using Fastify versioning plugin |
| 24 | **Database Migrations** | Schema changes are ad-hoc (manual SQL or code-first) | Production DB corruption risk; can't rollback | Add migration system: numbered SQL files in `migrations/`, run on startup, track applied in `_migrations` table. Use transactions |
| 25 | **Feature Flags** | No capability to gradually roll out features | Every deploy is all-or-nothing; can't dark-launch | Add feature flag system: SQLite-backed, toggled via admin panel or env var. Supported values: `on | off | percentage` |

---

## P3 — Low (Nice-to-Have / Future)

| # | Area | Issue | Suggested Approach |
|---|------|-------|--------------------|
| 26 | **Responsive Design** | Desktop-only; breaks on mobile | Add mobile-first media queries; collapse sidebar to hamburger; stack panels vertically | [x] Mobile sidebar overlay + hamburger + responsive font/padding/width queries |
| 27 | **CI Performance** | No performance regression tests | Add Lighthouse CI for web client; add `hyperfine` benchmarks for critical server operations | [~] Pending |
| 28 | **Collaboration** | Single-user only | Add multi-user support: rooms, shared swarm state, user presence, permission model | [~] Pending |
| 29 | **Plugin SDK** | Plugin system exists but no published SDK | Publish `@custom-pi/plugin-sdk` with types, base classes, example, and sandbox |
| 30 | **Model Fine-Tuning** | Self-modifier only patches source code | Add pipeline to fine-tune a small LLM (LoRA) on user corrections and preferences |
| 31 | **Voice UI** | Voice input only in VoicePanel | Add "Hey Custom-PI" wake word detection. Voice commands for sidebar navigation, swarm launch |
| 32 | **Analytics** | No telemetry | Add privacy-first local analytics: feature usage, error rates, performance metrics. Optional opt-in remote telemetry |
| 33 | **Desktop App** | Web-only; no native desktop | Package with Tauri or Electron for native system tray, desktop notifications, file system access |
| 34 | **K8s Support** | Docker-only | Add Helm chart with horizontal pod autoscaling, liveness probes, ConfigMap for settings, PVC for SQLite |

---

## UI/UX Pain Points

### Immediate Fixes (P1):
- **Spinner instead of blank** — Every panel needs a loading skeleton. Currently panels either show stale data or flash-empty then populate — [x] `LoadingSkeleton.tsx` created (text/card/table/circle variants). **23/28 panels retrofitted**
- **Empty states** — "No agents", "No emails", "No contacts" should be illustrated, friendly messages, not blank screens — [x] Basic empty states in all panels; 23/28 have loading + error states too
- **Consistent spacing** — Some panels use 8px grid, others don't. Standardize on the CSS custom properties already defined in `globals.css` — [x] CSS custom properties (`--spacing-xs`, etc.) available in globals.css. Responsive media queries added for mobile sidebar, content area, command palette.
- **Sidebar scroll** — 28 items already overflow; needs search/filter or collapsing groups — [x] Search/filter added to Sidebar.tsx
- **Toast positioning** — Toasts overlap sidebar; move to top-right center — [x] Moved to top-right with higher z-index (10000).

### Medium-Term (P2):
- **Command palette** — Cmd+K search across all entities (agents, teams, contacts, notes, settings) — [x] `CommandPalette.tsx` with Cmd+K, arrow navigation, 28 views + commands
- **Drag-and-drop** — Reorder sidebar items; drag files from gallery to chat
- **Responsive sidebar** — Collapse to icon-only on narrow screens; hamburger on mobile
- **Breadcrumbs** — When navigating deep (e.g., Settings > Models > Provider Detail), show path
- **Theme preview** — Theme list should show color swatches, not just names

### Architectural (P2):
- **State persistence** — Restore last-viewed panel, scroll positions, unsaved form input on navigation
- **Undo everywhere** — Delete a team? Undo bar appears for 5 seconds. Edit a setting? Ctrl+Z reverts
- **Optimistic updates** — When creating a team, show it immediately in the list before API responds; rollback on error
- **Keyboard shortcuts cheat sheet** — Press `?` to show all available shortcuts — [x] Done: `KeyboardShortcuts.tsx` overlay with `?` key listener + `role="dialog"` + `aria-modal`

---

## AI/ML-Specific Gaps

| Area | Current State | Target State |
|------|---------------|--------------|
| **Model Selection** | Static `models.json` config; user picks manually | Automatic model selection based on task type + cost + latency + past success rate |
| **Prompt Engineering** | Hardcoded in source | Versioned prompt library with A/B testing and LLM-optimized prompts |
| **Evaluation** | None | Automated eval suite with pass/fail benchmarks run in CI |
| **Online Learning** | Stores correction patterns, doesn't update model | LoRA fine-tuning on user corrections + preference learning |
| **RAG Quality** | TF-IDF + BM25 + Dense hybrid search | Add reranking, query expansion, and self-querying retrieval |
| **Tool Selection** | All tools available all the time | Learn which tools work for which tasks via bandit-style exploration |
| **Memory Consolidation** | Hourly batch compaction | Real-time incremental consolidation with importance scoring |
| **Cost Optimization** | Reactive tracking | Predictive budgeting + automatic model downgrade for simple tasks |

---

## Quick Wins (<2 hours each)

1. Add loading skeletons to all 28 panels (copy pattern from Dashboard) — [x] `LoadingSkeleton.tsx` + `PanelLoadingSpinner` + `PanelErrorCard` created. **23/28 panels retrofitted**: Contacts, Email, Notes, Health, Vault, Budget, Memory, Agents, Calendar, Social, Team, Cookbook, Pipeline, DeepResearch, ImageGallery, Settings, Admin, MCP, WorkProducts, KnowledgeGraph, ModelComparison, Voice, Dashboard
2. Fix empty states on all list panels — [x] All panels have empty states ("No X yet"), 23 panels also have loading/error states
3. Standardize error response format on all endpoints — [x] Done: `sendError()` helper in `web-server.mjs`, centralized via `setErrorHandler`, auth + rate-limit + not-found standardized
4. Add Fastify schema validation to the 10 most-called endpoints — [x] Done: `/api/models`, `/api/social/status`, `/api/memory/stats`, `/api/swarm/teams`, `/api/vault/list`, `/api/mcp/config`, `/api/work-products`, `/api/budget/stats`, `/api/system/rate-limits`, `/api/chat/completions`. Plus notes/tasks/contacts/calendar/vault/memory/settings (16 total)
5. Add keyboard shortcut `?` to show help overlay — [x] `KeyboardShortcuts.tsx` component + `?` key listener in `App.tsx`
6. Add `react-router-dom` for the 5 main navigation destinations — [x] `BrowserRouter` + 30 `<Route>` entries. `react-router-dom` v7.6.2
7. Add API version prefix — [x] `/api/v1/*` → `/api/*` URL rewrite via onRequest hook
8. Add search filter to sidebar — [x] Search input in `Sidebar.tsx` with real-time filtering of 28 NAV_ITEMS
9. Add optimistic updates to team creation/deletion — [x] Create/delete team + add/remove agent all have optimistic updates with rollback on error.
10. Extract all prompts from source to JSON files — [x] **30+ prompts** extracted to `prompts/` directory. Loader at `prompts/prompts.mjs`. `soul-loader.ts` updated
