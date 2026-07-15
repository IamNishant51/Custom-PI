# AGENTS.md — Custom-PI System Reference

> For developer workflow (build, test, lint, commit), see [AGENT.md](AGENT.md).

## Architecture

```
User Input → CEO Orchestrator → DAG Planner → Hive Mind → Tool Call → 26+ Subsystems
```

Custom-PI is a multi-agent system built on `@earendil-works/pi-coding-agent` (v0.77.0). The CEO Orchestrator receives user input, optionally decomposes complex goals into DAGs of sub-tasks, forms teams via the Hive Mind, executes via 40+ tools, and persists state through 26+ background subsystems.

### Agent Types

| Type | Source | Description |
|---|---|---|
| CEO Orchestrator | Built into Pi Agent | Primary ReAct loop, slash commands, mode toggle |
| DAG Swarm Agents | `assets/agents/*.yaml` | Pre-configured pipeline/parallel agents |
| Hive Mind Agents | Dynamic at runtime | Auto-formed teams per task requirements |
| Ascension Subsystems | `assets/extensions/subagents/src/*/` | 26 background daemons (event bus, memory, health, etc.) |

## Runtime Layout (`~/.pi/agent/`)

| Path | Purpose |
|---|---|
| `SOUL.md` | Agent identity/personality (edit to customise) |
| `SYSTEM.md` | Core programming rules (edit cautiously) |
| `settings.json` | Model + behaviour settings |
| `models.json` | API keys, endpoints, `contextWindow` per model |
| `session-state.db` | SQLite: messages, triplets, health, rate limits |
| `state-graph.db` | SQLite: property graph (nodes + edges with predicates) |
| `dag-config.yaml` | Swarm configurations |
| `mcp-servers.json` | MCP server registry |
| `.vault/master.key` | AES-256-GCM encryption key |
| `.vault/vault.json` | Encrypted credentials store |
| `extensions/subagents/src/` | TypeScript source for all extensions |
| `plugins/` | Installed plugin scripts |
| `checkpoints/` | Session state snapshots |

## Source Layout (`assets/extensions/subagents/src/`)

| Area | Key Files | Purpose |
|---|---|---|
| **Entry** | `index.ts` (~3000 lines) | Tool/command/hook registration, `@ts-nocheck` is intentional |
| **TUI** | `tui/` | Fullscreen terminal UI (frame-based, double-buffered `Uint32Array`) |
| **Daemon** | `daemon/daemon.ts` | Background task scheduler (SQLite-only persistence) |
| **Event Bus** | `event-bus/` | Typed pub/sub mesh — 70+ topics, no direct coupling between subsystems |
| **State Graph** | `state-graph/` | SQLite property graph with FTS5 + BFS traversal |
| **Swarm** | `swarm/` | Hive Mind team formation + consensus voting |
| **Cognition** | `cognition/` | Goal decomposer, episodic memory, theory of mind, metacognition |
| **Autonomy** | `autonomy/` | Initiative engine, financial autonomy, self-healer, security autopilot |
| **Perception** | `perception/` | Environment sensor + web sentience |
| **Evolution** | `evolution/` | Self-modifier + continuous learning |
| **Execution** | `execution/` | Full-stack generator + database intelligence |
| **Omega** | `omega/` | Long-term planner + causal reasoner + universal tool creator |
| **Plugin** | `plugin-system/` | Plugin lifecycle hooks + sandbox |
| **Memory** | `memory-*.ts`, `state-db.ts` | Three-tier: episodic (SQLite), hybrid (BM25+dense+graph), knowledge graph |
| **Tools** | `tools/` | Tool definitions split from index.ts |
| **Orchestrator** | `orchestrator/` | Deployment pipeline orchestration |
| **Web** | `assets/web/` | Fastify server (`web-server.mjs`), React client (`client/`) |

## CEO Slash Commands

| Command | Action |
|---|---|
| `/models` | List/switch models |
| `/triplets [entity]` | List knowledge graph triplets or drill into entity |
| `/daemon start\|stop\|status` | Background daemon control |
| `/plan` | Show current multi-step plan |
| `/memory <query>` | Search episodic + semantic memory |
| `/budget` | Token/cost usage |
| `/vault list` | List encrypted vault keys (values never shown) |
| `/agents` | List all Hive Mind agents |
| `/ascension` | Boot all 26 subsystems |
| Tab (TUI) | Toggle AGENT MODE ↔ PLAN MODE |

## Built-In Swarm Agents

All defined in `assets/agents/*.yaml`. Key agents:

| Agent | Tools | Depends On |
|---|---|---|
| `researcher` | web_search, web_fetch, memory_search, glob, grep | — |
| `coder` | write, edit, bash, glob, grep, lsp, ast_grep, hashline_edit | researcher |
| `reviewer` | bash, glob, grep, lsp | coder |
| `security-auditor` | bash, glob, grep, web_search, ast_grep | — |
| `deployment-orchestrator` | bash, github, web_fetch, ssh_exec, vault_get | — |
| `full-stack-generator` | write, edit, bash, glob, web_search, web_fetch, lsp | — |

**Social media swarm** (default pipeline): `researcher` → `writer` (calls `generate_image` + `request_asset_selection`) → `publisher` (calls `request_post_approval` + social platform tools).

## Tool Arsenal (40+)

### Media
`generate_image` (Pollinations.ai, free; or DesignAPI), `request_asset_selection`, `text_to_speech`, `render_mermaid`

### Social
`post_to_twitter` (Playwright), `post_to_reddit`, `post_to_bluesky`, `post_to_discord`, `post_to_telegram`, `request_post_approval`

### Knowledge
`memory_store`, `memory_search`, `memory_edit`, `vault_set/get/delete/list/import`

### Search & Web
`web_search` (DDG → Algolia → Wikipedia fallback chain), `web_fetch`, `internal_url`

### Code
`lsp` (TS/JS/Python/Go/Rust/Java via `lsp-servers.json`), `ast_grep` (11 languages), `hashline_edit` (content-hash validated)

### Shell
`bash` (60+ command allowlist — includes git/npm/npx/node/python3/docker but blocks sudo/su/eval/exec), `ssh_exec`, `browser` (headless Chromium, SSRF-safe)

### Integration
`github`, `send_email` (Gmail OAuth 2.0), `plugin` (sandboxed JS)

### Ascension
`initialize_ascension`, `shutdown_ascension`, `decompose_goal`, `long_term_plan`, `causal_analyze`, `create_tool`

## Key Subsystems (26+ Ascension Engine)

### Event Bus
- 70+ typed topics (`tool.start`, `memory.extract`, `health.fail`, `swarm.agent_done`, etc.)
- Correlation IDs for tracing, middleware pipeline for filtering/transformation
- Location: `event-bus/`

### State Graph (Property Graph DB)
- `~/.pi/agent/state-graph.db` — SQLite with `nodes` + `edges` tables + FTS5
- Node types: tool, file, function, class, concept, dependency, setting, person
- Common predicates: `uses`, `depends_on`, `caused_by`, `knows_about`, `built_with`
- Querying: `graph.getNode()`, `graph.getNeighbors(id, depth)`, `graph.findPath()`, `graph.search()` (FTS5)
- Auto-learning: LLM extracts new triplets from tool outputs every 5 minutes

### Background Daemon
- Separate Node.js process, started via `/daemon start`
- Scheduled tasks: memory consolidation (6h), health checks (5min), security scan (weekly Mon 02:00), knowledge extraction (5min when idle), dream consolidation (30min idle)
- Heartbeat to SQLite every 30s

### Memory (3-Tier)
1. **Episodic** — SQLite `episodes` table, sessions with emotional valence, dream consolidation during idle
2. **Hybrid Search** — BM25 (FTS5) + dense cosine + graph traversal + cross-encoder reranking
3. **Knowledge Graph** — Triplets with confidence scoring, TTL-based pruning

### Security Autopilot
- Scans for 20+ secret patterns (AWS keys, GH tokens, JWTs, connection strings)
- Security score = `100 - (critical×40) - (high×15) - (medium×5) - (low×1)`
- Below 70 = warning, below 40 = alert

## Writing New Agents

1. Create `assets/agents/<name>.yaml` with `id`, `role`, `tools`, `waits_for`, `system_prompt`
2. Register capabilities in `swarm/capabilities.ts`
3. Test via temp DAG: `dag-config.yaml` with sequential mode

## Writing New Tools

1. Add to `tools/<name>.ts` (or `index.ts` for now)
2. Implement `ToolDefinition<Input, Output>` with `name`, `description`, `inputSchema`, `execute`
3. Call `ctx.checkBudget()` before expensive operations
4. Emit tool-specific events via `ctx.eventBus.emit()`
5. Register in the tool registry (currently in `index.ts`)

## Security Rules (Hard — Cannot Override)

- **Always confirm**: `rm -rf`, `dd if=`, `mkfs`, `format`, `ssh_exec` on prod, any `post_to_*`, `send_email`, `vault_delete`, `self_modify`, deploy to production
- **Vault**: agents cannot read `.vault/` directly, only via `vault_*` tools
- **Browser**: cannot navigate to localhost/RFC 1918 addresses (SSRF prevention)
- **Bash**: no shell injection (`;`, `&&`, `||` between commands checked)
- **Social**: browser auth persisted to `~/.pi/agent/.playwright/`, re-auth ~every 30 days
- **MCP server start**: command allowlist only — `npx`, `node`, `uvx`, `python3`, `deno`, `bun`

## Compaction & Context Budget

- Settings in `settings.json`: only `"enabled": true` — values computed dynamically
- `reserveTokens = max(4096, contextWindow × 0.12)` — 12% headroom
- `keepRecentTokens = max(8192, contextWindow × 0.40)` — 40% recent conversation preserved
- Auto-compaction triggers at >90% usage via `session.compact()`
- Never hardcode `reserveTokens`/`keepRecentTokens` in `settings.json`
- New providers: ensure `contextWindow` in `models.json` is correct

## Agent Communication Protocols

1. **Direct (CEO → Sub-agent)**: CEO writes task to shared State Graph namespace, sub-agent polls
2. **Event Bus (Broadcast)**: Typed pub/sub, no point-to-point
3. **File Handoff**: Agents write to `~/.pi/agent/swarm/{swarm-id}/{step}/output.md`
4. **State Graph Handoff**: Agents write/read structured data via `stateGraph.upsertNode()` / `getNode()`

## Error Recovery

| Failure | Recovery |
|---|---|
| Tool timeout | Retry ×3 with exponential backoff |
| LLM API error | Fallback model (configured in `model-router.ts`) |
| File conflict | Advisory lock (`withFileLock`), wait 30s, then fail |
| Context too large | `session.compact()`, then summarise and continue |
| Sub-agent crash | CEO reassigns task |
| Consensus fail | Retry ×1, escalate to CEO → user |

## TUI Architecture

Custom frame-based renderer (no React/Ink). Stack: `TuiApp` → `TuiManager` → `ScreenRenderer` → `TerminalScreen` (`Uint32Array` double-buffer with dirty-rect tracking).

Key features: Vim input mode, 6 spinner types, animation timeline with easing, toast notifications, SGR mouse support, thinking block collapse, responsive breakpoints (compact <80 / normal <120 / wide 120+), 52-token dark theme (`THEME` in `theme/theme.ts`).

The TUI co-exists with a monkey-patched legacy renderer in `patches/index.ts` that modifies `@earendil-works/pi-tui` prototypes at load time.
