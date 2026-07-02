# AGENTS.md — Custom-PI Complete Agent Reference
> **Version:** v1.11.0 | **Updated:** 2026-06-25
> The definitive guide to every agent, swarm, subsystem, tool, and autonomous capability in custom-pi.
> Read this before adding new agents, modifying swarm configs, or extending the tool arsenal.

---

## TABLE OF CONTENTS

1. [Agent System Overview](#1-agent-system-overview)
2. [The CEO Orchestrator](#2-the-ceo-orchestrator)
3. [Built-In Swarm Agents](#3-built-in-swarm-agents)
4. [Ascension Engine — 26+ Subsystems](#4-ascension-engine--26-subsystems)
5. [Tool Arsenal — 40+ Tools](#5-tool-arsenal--40-tools)
6. [DAG Swarm Configuration](#6-dag-swarm-configuration)
7. [Hive Mind — Dynamic Teams](#7-hive-mind--dynamic-teams)
8. [Memory Architecture](#8-memory-architecture)
9. [Event Bus — The Nervous System](#9-event-bus--the-nervous-system)
10. [State Graph — The Property Graph Database](#10-state-graph--the-property-graph-database)
11. [Background Daemon](#11-background-daemon)
12. [MCP Ecosystem](#12-mcp-ecosystem)
13. [Plugin System — Phase 8](#13-plugin-system--phase-8)
14. [SOUL.md & SYSTEM.md — Identity Layer](#14-soulmd--systemmd--identity-layer)
15. [Writing New Agents](#15-writing-new-agents)
16. [Writing New Tools](#16-writing-new-tools)
17. [Agent Communication Protocols](#17-agent-communication-protocols)
18. [Agent Lifecycle & Error Recovery](#18-agent-lifecycle--error-recovery)
19. [Security Rules for Agents](#19-security-rules-for-agents)
20. [Planned Future Agents](#20-planned-future-agents)

---

## 1. AGENT SYSTEM OVERVIEW

custom-pi is a multi-agent AI system built on top of the Pi Coding Agent (`@earendil-works/pi-coding-agent`). The system uses a hierarchical orchestration model:

```
User Input
    │
    ▼
CEO Orchestrator  ←── SOUL.md (identity) + SYSTEM.md (rules)
    │                  + Dynamic Context (memory, health, budget)
    ▼
┌───────────────────────────────────────────────┐
│  DAG Planner  ──►  Hive Mind  ──►  Tool Call  │
│  (decompose)       (team form)     (execute)   │
└───────────────────────────────────────────────┘
    │
    ▼
Sub-Agents (Researcher, Writer, Reviewer, Publisher, ...)
    │
    ▼
40+ Tools (bash, browser, web_search, generate_image, ...)
    │
    ▼
26+ Ascension Subsystems (event bus, memory, health, ...)
```

### Agent Types

| Type | Count | Description |
|---|---|---|
| **CEO Orchestrator** | 1 | Primary agent that receives user input and coordinates all others |
| **DAG Swarm Agents** | Variable | Defined in `dag-config.yaml`; form pipelines and parallel teams |
| **Hive Mind Agents** | Dynamic | Auto-formed teams based on task requirements |
| **Ascension Agents** | 26 | Autonomous subsystems that run continuously in the background |
| **Custom Agents** | Unlimited | User-defined agents in `assets/agents/` |

### Runtime File Locations

```
~/.pi/agent/
├── SOUL.md                     # Agent identity definition — edit this to customise personality
├── SYSTEM.md                   # Core programming rules — edit cautiously
├── settings.json               # Model and behaviour settings
├── models.json                 # API keys, model endpoints, contextWindow per model
├── session-state.db            # SQLite: messages, triplets, health, rate limits
├── state-graph.db              # SQLite: property graph for all agent state
├── dag-config.yaml             # Swarm configurations
├── mcp-servers.json            # MCP server registry
├── lsp-servers.json            # LSP server language mappings
├── assets/                     # Generated images (from generate_image tool)
├── .vault/
│   ├── master.key              # AES-256-GCM encryption key (protect this file)
│   └── vault.json              # Encrypted credentials store
├── extensions/subagents/src/   # TypeScript source for all agent extensions
├── plugins/                    # Installed plugin scripts
├── checkpoints/                # Session state snapshots
├── costs/                      # Per-session token cost logs
├── work-products/              # Ledger of all files created/modified by agents
└── web/                        # Compiled React Web UI distribution
```

---

## 2. THE CEO ORCHESTRATOR

The CEO Orchestrator is the primary agent. It is a Pi Coding Agent instance configured with the custom-pi system prompt, all 40+ tools, and all custom commands.

### Configuration

The CEO's behaviour is defined by three layers (applied in order, later layers override earlier):

**Layer 1 — Base Pi Agent:** The underlying `@earendil-works/pi-coding-agent` provides the core ReAct loop, tool invocation, and streaming output.

**Layer 2 — SYSTEM.md:** Injected as the system prompt. Defines hard rules: never delete files without confirmation, always explain tool calls, format code in markdown blocks, never commit without permission.

**Layer 3 — SOUL.md:** Injected after SYSTEM.md. Defines personality: the agent's name, communication style, values, and areas of expertise. This is the "who" layer on top of SYSTEM.md's "what" layer.

### CEO State Machine

```
IDLE ──(user input)──► THINKING
THINKING ──(tool call needed)──► EXECUTING
EXECUTING ──(tool complete)──► THINKING
THINKING ──(response ready)──► RESPONDING
RESPONDING ──(streamed)──► IDLE

THINKING ──(goal too complex)──► DECOMPOSING
DECOMPOSING ──(DAG created)──► DISPATCHING
DISPATCHING ──(agents assigned)──► COORDINATING
COORDINATING ──(all agents done)──► SYNTHESIZING
SYNTHESIZING ──(summary ready)──► RESPONDING
```

### CEO Slash Commands

These commands are intercepted before they reach the LLM:

| Command | Description |
|---|---|
| `/models` | List all configured models and switch active model |
| `/triplets` | List top 20 knowledge graph triplets |
| `/triplets <entity>` | Drill into a specific entity's connections |
| `/daemon start` | Start the background daemon |
| `/daemon stop` | Stop the background daemon |
| `/daemon status` | Show daemon health and scheduled tasks |
| `/plan` | Show the current multi-step plan |
| `/memory <query>` | Search episodic and semantic memory |
| `/budget` | Show current session token/cost usage |
| `/vault list` | List vault keys (values are always encrypted) |
| `/agents` | Show all registered agents in the Hive Mind |
| `/ascension` | Boot all 26 Ascension subsystems |

### CEO Mode Toggle

Press `Tab` in the TUI to toggle between:

- `◆ AGENT MODE` (green) — Full tool access. Agent can read, write, edit, execute bash commands, post to social media, etc.
- `◆ PLAN MODE` (amber) — Read-only. Write/edit tools are blocked at the `tool_call` event level. Agent is told not to retry. Use this for planning sessions where you want to see the agent's strategy without it taking actions.

---

## 3. BUILT-IN SWARM AGENTS

These agents are pre-configured in `assets/agents/` and can be composed into swarms via `dag-config.yaml`.

### 3.1 Researcher

```yaml
id: researcher
role: Research specifications, codebase structure, and external information
tools: [web_search, web_fetch, memory_search, glob, grep]
waits_for: []
system_prompt: |
  You are a thorough research agent. Your job is to gather all necessary information
  before any code is written. Search the web, the codebase, and memory for relevant
  context. Output structured findings with source citations. Never make assumptions —
  if you're unsure, search again.
```

**Best for:** Gathering requirements, understanding a codebase before modifying it, finding relevant npm packages, searching for API documentation.

**Output format:** Structured markdown with sections: "Codebase Context", "External References", "Key Findings", "Open Questions".

### 3.2 Coder / Implementer

```yaml
id: coder
role: Implement features, fix bugs, and write clean, tested code
tools: [write, edit, bash, glob, grep, lsp, ast_grep, hashline_edit]
waits_for: [researcher]
system_prompt: |
  You are a senior software engineer. You write clean, typed, tested code.
  Always read existing code before modifying it. Follow the conventions in
  AGENT.md. Write TypeScript with strict types. Add JSDoc to public APIs.
  Never introduce new dependencies without checking if an existing one works.
```

**Best for:** Feature implementation, bug fixes, refactoring, test writing.

**Waits for:** `researcher` (needs context before touching code).

### 3.3 Reviewer

```yaml
id: reviewer
role: Validate type checks, tests, and compiler output
tools: [bash, glob, grep, lsp]
waits_for: [coder]
system_prompt: |
  You are a code reviewer. Your job is to catch bugs, type errors, and test
  failures BEFORE they hit main. Run: npx tsc --noEmit, npx vitest run.
  Check for: unused imports, empty catch blocks, hardcoded values that should
  be constants, missing error handling. Report issues in structured format.
  Do NOT fix issues yourself — report them back to the coder.
```

**Best for:** Quality gate before committing. Part of the default `pipeline` mode loop.

**Waits for:** `coder`.

### 3.4 Researcher → Writer → Publisher (Social Media Swarm)

This is the **default pre-configured swarm** shipped with custom-pi:

```yaml
version: 1
mode: pipeline
pipeline_count: 3
agents:
  - id: researcher
    role: Find trending topics, news, and content ideas using web search
    tools: [web_search, web_fetch, write]
    waits_for: []

  - id: writer
    role: Draft platform-optimized posts and generate matching visuals
    tools: [write, edit, read, generate_image, request_asset_selection]
    waits_for: [researcher]

  - id: publisher
    role: Show post previews for approval, then publish to connected platforms
    tools: [post_to_twitter, post_to_reddit, post_to_bluesky,
            post_to_discord, post_to_telegram, request_post_approval]
    waits_for: [writer]
```

**Full workflow:**

1. `researcher` finds a trending topic (e.g., "new Rust async feature")
2. `researcher` writes a content brief to a shared file
3. `writer` reads the brief, drafts 280-char Twitter + Reddit post
4. `writer` calls `generate_image` (4 free images from Pollinations.ai)
5. `writer` calls `request_asset_selection` → Web UI modal opens → user picks 1 image
6. `publisher` calls `request_post_approval` → Web UI preview → user approves/edits/skips
7. `publisher` calls `post_to_twitter` and `post_to_reddit`

### 3.5 Security Auditor

```yaml
id: security-auditor
role: Scan for vulnerabilities, secret leaks, and security anti-patterns
tools: [bash, glob, grep, web_search, ast_grep]
waits_for: []
system_prompt: |
  You are a security engineer specialising in Node.js and TypeScript applications.
  Scan for: hardcoded secrets, path traversal, SQL injection, XSS, prototype
  pollution, ReDoS, shell injection, insecure dependencies. Report findings
  with severity (critical/high/medium/low), file path, line number, and
  specific remediation steps. Run: npm audit. Check for known-bad patterns
  with ast_grep.
```

**Triggered by:** Webhook from GitHub Dependabot, scheduled weekly by daemon, or manually via `/run-security-audit`.

### 3.6 PR Reviewer Swarm

```yaml
version: 1
mode: parallel
agents:
  - id: logic-reviewer
    role: Review business logic, algorithm correctness, edge cases
    tools: [read, glob, grep, lsp, web_search]

  - id: security-reviewer
    role: Review for security vulnerabilities (see security-auditor above)
    tools: [read, glob, grep, ast_grep, bash]

  - id: test-reviewer
    role: Check test coverage, test quality, missing test cases
    tools: [read, bash, glob, grep]
    
  - id: style-reviewer
    role: Check code style, naming conventions, documentation
    tools: [read, glob, grep, lsp]
```

All 4 run in parallel on PR creation (triggered by GitHub webhook → `POST /api/webhooks/github`). Results are merged into a structured PR review comment posted back to GitHub via the `github` tool.

### 3.7 Full-Stack Generator Agent

Not a swarm — a single specialised agent with a huge toolset:

```yaml
id: full-stack-generator
role: Generate complete projects from a specification
tools: [write, edit, bash, glob, web_search, web_fetch, lsp]
system_prompt: |
  You are a full-stack architect. Given a project spec, generate:
  - package.json with all dependencies
  - Database schema + SQL migrations
  - JWT authentication middleware
  - REST API with Express/Fastify routes
  - React frontend with components
  - Docker setup (Dockerfile + docker-compose.yml)
  - GitHub Actions CI pipeline
  - README.md
  Follow the conventions in AGENT.md for this project's stack.
```

**Output:** A complete runnable project in a new subdirectory.

### 3.8 Deployment Orchestrator

```yaml
id: deployment-orchestrator
role: Manage the 6-stage CI/CD pipeline with auto-rollback
tools: [bash, github, web_fetch, ssh_exec, vault_get]
system_prompt: |
  You manage the deployment pipeline. Stages in order:
  1. PR → merge check (tests pass, no conflicts)
  2. Build → npm run build, Docker image tag
  3. Tests → npx vitest run, npx tsc --noEmit
  4. Staging → deploy to staging environment via SSH
  5. Smoke tests → GET /api/health on staging
  6. Production → deploy if smoke tests pass; rollback if not
  
  Auto-rollback trigger: 3 consecutive smoke test failures.
  Always log each stage to the state graph.
```

---

## 4. ASCENSION ENGINE — 26+ SUBSYSTEMS

The Ascension Engine is booted via `initialize_ascension` and runs all subsystems in the background. Each subsystem communicates through the Event Bus (see Section 9).

### Phase 0 — Foundation (Nervous System)

#### Event Bus
**File:** `assets/extensions/subagents/src/event-bus/`
**Role:** Typed publish/subscribe mesh connecting all 26 subsystems.
**Key properties:**
- 70+ typed event topics (e.g., `tool.start`, `tool.end`, `health.check`, `memory.extract`, `swarm.agent_done`)
- History replay: new subscribers can request the last N events on a topic
- Middleware pipeline: events can be filtered, transformed, or logged before delivery
- Correlation IDs: each event carries a trace ID linking it to its origin request
- No direct coupling: subsystems never call each other directly — only via events

**Critical rule:** NEVER emit `tool.start` and `tool.end` from outside the tool executor. These events are used by the Metacognition subsystem to track strategy performance.

#### State Graph
**File:** `assets/extensions/subagents/src/state-graph/`
**Role:** SQLite-backed property graph database storing all agent state.
**Schema:**
```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,     -- 'tool', 'file', 'function', 'class', 'concept', 'dependency', 'setting', 'person'
  properties TEXT,        -- JSON blob
  created_at INTEGER,
  updated_at INTEGER,
  ttl INTEGER             -- Timestamp after which node expires (NULL = never)
);

CREATE TABLE edges (
  source_id TEXT REFERENCES nodes(id),
  target_id TEXT REFERENCES nodes(id),
  predicate TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,   -- 0.0 to 1.0
  created_at INTEGER,
  PRIMARY KEY (source_id, target_id, predicate)
);

CREATE VIRTUAL TABLE nodes_fts USING fts5(id, properties);
```

**Querying:**
- `graph.getNode(id)` → node with all properties
- `graph.getNeighbors(id, depth)` → BFS traversal up to N hops
- `graph.findPath(source, target)` → shortest path via recursive CTE
- `graph.search(query)` → FTS5 full-text search across all node properties

#### Hybrid Search Engine
**File:** `assets/extensions/subagents/src/` (integrated into state-db)
**Role:** Four-strategy fusion search across all knowledge bases.

| Strategy | Type | When Used | Scoring |
|---|---|---|---|
| BM25 | Sparse keyword | Code symbols, exact terms | TF-IDF |
| Dense Cosine | Semantic | Conceptual queries | Cosine similarity |
| Graph Traversal | Relational | "What connects to X?" | Path length |
| Cross-encoder | Reranking | Final precision sort | Learned relevance |

**Selection logic:** The search engine classifies each query and weights strategies accordingly. Code queries (`function`, `class`, identifiers) → 70% BM25. Natural language queries → 70% Dense. Relational queries (`depends on`, `uses`) → 70% Graph.

#### Background Daemon
**File:** `assets/extensions/subagents/src/daemon/daemon.ts`
**Role:** 24/7 persistent background process with scheduled tasks.
**State persistence:** SQLite only (JSON file writes removed in v1.10.0).
**Managed tasks:**

| Task | Schedule | Description |
|---|---|---|
| Memory consolidation | Every 6 hours | Compress old episodes, merge near-duplicate triplets |
| Health checks | Every 5 minutes | Ping all monitored endpoints |
| Security scan | Weekly (Monday 02:00) | Scan for secret leaks in project files |
| Cost report | Daily 09:00 | Email cost summary if `SEND_DAILY_REPORT=true` |
| Knowledge extraction | Every 5 minutes (when idle) | LLM-extract triplets from recent tool outputs |
| Dream consolidation | When idle > 30 minutes | Offline episode replay for learning |

**Starting:** `custom-pi /daemon start` or via the Web UI → Dashboard → Daemon panel.

---

### Phase 1 — Cognition (Brain)

#### Goal Decomposer
**File:** `assets/extensions/subagents/src/cognition/`
**Role:** LLM-powered decomposition of complex goals into DAGs of sub-tasks.
**Input:** A high-level goal string (e.g., "Add authentication to the API")
**Output:** A DAG where each node is a `SubTask`:
```typescript
interface SubTask {
  id: string;
  description: string;
  estimatedTokens: number;
  priorityScore: number;         // 0-10
  dependencies: string[];         // IDs of tasks that must complete first
  suggestedAgent: string;         // Which agent role should handle this
  successCriteria: string[];      // How to verify this task is done
}
```
**Adaptive re-planning:** If a sub-task fails, the Goal Decomposer is called again with the failure context to generate an alternative path.

#### Episodic Memory
**File:** `assets/extensions/subagents/src/cognition/`
**Role:** Stores entire sessions as episodes with emotional valence.

```typescript
interface Episode {
  id: string;
  timestamp: number;
  type: 'session' | 'success' | 'failure';
  context: string;         // Summary of what was being worked on
  outcome: string;         // What happened
  valence: number;         // -1.0 (failure) to +1.0 (success)
  gist?: string;           // Compressed summary (after auto-compression)
  tags: string[];          // Extracted keywords for retrieval
}
```

**Dream consolidation:** During idle periods (30+ minutes without user input), the daemon triggers offline episode replay. Recent failures are re-processed to extract lessons. Episodes older than 30 days are compressed to gist summaries.

**Retrieval:** When the agent faces a new task, episodic memory is searched for similar past situations:
```
"Fix auth bug in Express" → retrieves:
  Episode #42: "Fixed JWT expiry bug" (valence: 0.9)
  Episode #38: "OAuth implementation failed" (valence: -0.6)
```
Both successes and failures are valuable — failures teach what not to do.

#### Theory of Mind
**File:** `assets/extensions/subagents/src/cognition/`
**Role:** Maintains a dynamic model of the user's expertise, emotional state, and preferences.

```typescript
interface UserModel {
  expertiseLevel: 'novice' | 'intermediate' | 'expert' | 'unknown';
  preferredLanguages: string[];      // ['TypeScript', 'Python']
  communicationStyle: 'concise' | 'verbose' | 'socratic';
  emotionalState: 'neutral' | 'frustrated' | 'curious' | 'urgent';
  trustLevel: number;                // 0.0-1.0 (affects autonomy level)
  preferredVerbosity: number;        // 0.0-1.0
  correctionRate: number;            // How often user corrects the agent
  sessionStartTime: number;
}
```

**Adaptation rules:**
- If `correctionRate > 0.3` → reduce autonomy, ask more clarifying questions
- If `emotionalState === 'frustrated'` → simplify explanations, avoid jargon
- If `expertiseLevel === 'expert'` → skip obvious explanations, use technical terms freely
- If `trustLevel > 0.8` → allow autonomous file writes without per-action confirmation

**TODO (see IMPROVEMENTS.md §12.2):** Persist the user model to SQLite so it improves across sessions.

#### Metacognition
**File:** `assets/extensions/subagents/src/cognition/`
**Role:** The agent's ability to think about its own thinking.

**Strategies available:**

| Strategy | When Applied | Description |
|---|---|---|
| CoT (Chain of Thought) | Default | Step-by-step reasoning in the prompt |
| ToT (Tree of Thought) | Complex problems | Explore multiple solution paths simultaneously |
| ReAct | Tool-heavy tasks | Alternate Reasoning and Acting in a loop |
| Reflexion | After failure | Reflect on what went wrong, adjust strategy |

**Confidence assessment:** Before taking any autonomous action (file write, deployment, post), the metacognition module assesses confidence:
```typescript
interface ConfidenceAssessment {
  overallConfidence: number;     // 0.0-1.0
  knowledgeGaps: string[];       // Things the agent doesn't know
  risks: string[];               // Potential downsides
  recommendation: 'proceed' | 'ask_user' | 'gather_more_info';
}
```
If confidence < 0.7 on a destructive action, the agent asks for confirmation regardless of trust level.

---

### Phase 2 — Perception (Senses)

#### Environment Sensor
**File:** `assets/extensions/subagents/src/perception/`
**Role:** Continuous monitoring of the development environment.

**Monitored signals:**
- File system: recursive watchers on the project directory, detects creates/modifies/deletes
- Git state: current branch, dirty files, unpushed commits, CI status
- Running processes: port conflicts, resource usage, zombie processes
- System health: disk usage, memory pressure, CPU load
- Network: connectivity, DNS resolution, latency to key endpoints

**Events emitted:**
- `env.file_changed` → triggers Knowledge Extractor if it's a source file
- `env.git_dirty` → triggers the Initiative Engine to remind user to commit
- `env.disk_warning` → triggers the Self-Healer if disk > 85%
- `env.ci_failed` → triggers the Deployment Orchestrator to investigate

#### Web Sentience
**File:** `assets/extensions/subagents/src/perception/`
**Role:** Continuous web monitoring and trend detection.

**Scheduled jobs:**
- GitHub trending: scans trending repos every 4 hours, extracts relevant libraries
- Hacker News: monitors for relevant tech news, adds to knowledge graph
- npm new packages: discovers packages relevant to the current project stack
- Security advisories: monitors NVD for CVEs affecting installed dependencies

**Events emitted:**
- `web.trend_detected` → content for the Social Media swarm
- `web.package_discovered` → potential tool enhancement
- `web.cve_found` → Security Autopilot notification

---

### Phase 3 — Autonomy (Will)

#### Initiative Engine
**File:** `assets/extensions/subagents/src/autonomy/`
**Role:** Proactive opportunity detection and autonomous action.

**Opportunity scoring:**
```
Initiative_Score = Impact × Urgency × Confidence × UserReceptivity
```

**Example opportunities:**
| Opportunity | Impact | Urgency | Confidence | Score |
|---|---|---|---|---|
| Test coverage dropped from 80% to 65% | 0.8 | 0.5 | 0.9 | 0.36 |
| `npm audit` shows critical vulnerability | 1.0 | 1.0 | 1.0 | 1.00 |
| Disk 85% full | 0.6 | 0.6 | 1.0 | 0.36 |
| New version of dependency available | 0.3 | 0.2 | 0.8 | 0.05 |

**User receptivity:** Decreases if the user has dismissed the last 3 opportunities from the same category. Resets after 24 hours of no dismissals.

**Curiosity-driven exploration:** During idle periods, the agent explores the codebase:
- Reads files it hasn't read before
- Runs type checks on unchecked files
- Searches for TODOs and FIXMEs
- Indexes new files into the knowledge graph

#### Financial Autonomy
**File:** `assets/extensions/subagents/src/autonomy/`
**Role:** Token cost tracking and optimal model selection.

**Model selection scoring:**
```
ModelScore = SuccessRate × ContextFit / (Cost × Latency)
```

**Budget alert thresholds (configurable):**
- 50% of daily budget: warning notification
- 75% of daily budget: switch to cheaper models for non-critical tasks
- 90% of daily budget: pause autonomous operations, ask user

**Cost tracking per session:**
```typescript
interface SessionCost {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;    // USD
  tasks: Array<{ tool: string; tokens: number; cost: number; }>;
}
```

#### Self-Healer
**File:** `assets/extensions/subagents/src/autonomy/`
**Role:** Automatic recovery from component failures.

**Health check schedule:** Every 5 minutes (configurable).

**Monitored components:**
```typescript
const HEALTH_CHECKS: HealthCheck[] = [
  { name: 'sqlite', fn: () => db.prepare('SELECT 1').get() },
  { name: 'disk', fn: () => checkDiskSpace('/') },
  { name: 'memory', fn: () => checkMemoryUsage() },
  { name: 'network', fn: () => fetch('https://api.anthropic.com/health') },
  { name: 'event_bus', fn: () => eventBus.ping() },
];
```

**Auto-heal triggers (3+ consecutive failures):**
- SQLite: close all connections, vacuum, reopen
- Disk: archive old session files, clear temp files
- Memory: trigger garbage collection, reduce in-memory caches
- Network: exponential backoff, cache-only mode
- Event Bus: drain queue, restart publisher

#### Security Autopilot
**File:** `assets/extensions/subagents/src/autonomy/`
**Role:** Continuous secret scanning and security scoring.

**Secret patterns detected:**
```typescript
const SECRET_PATTERNS = [
  { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS Access Key', severity: 'critical' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Personal Token', severity: 'critical' },
  { pattern: /-----BEGIN RSA PRIVATE KEY-----/, name: 'RSA Private Key', severity: 'critical' },
  { pattern: /(?:password|passwd|pwd)\s*=\s*['"][^'"]{8,}['"]/, name: 'Hardcoded Password', severity: 'high' },
  { pattern: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/, name: 'JWT Token', severity: 'medium' },
  { pattern: /mongodb:\/\/[^:]+:[^@]+@/, name: 'MongoDB Connection String', severity: 'high' },
  // ... 20+ more patterns
];
```

**Security score calculation:**
```
SecurityScore = 100 - (critical × 40) - (high × 15) - (medium × 5) - (low × 1)
```
Score shown in Dashboard. Below 70 = warning. Below 40 = alert.

---

### Phase 4 — Swarm Intelligence (Collective)

#### Hive Mind
**File:** `assets/extensions/subagents/src/swarm/`
**Role:** Dynamic agent team formation based on task requirements.

**Team formation algorithm:**
1. Analyse task description → extract required capabilities
2. Match capabilities to available agent roles
3. Form minimum viable team (avoid redundancy)
4. Assign communication channels (shared state graph namespace)

**Consensus voting (for critical decisions):**
```typescript
type CriticalDecision = 'deploy_to_production' | 'delete_file' | 'modify_schema' | 'send_email';

async function vote(decision: CriticalDecision, context: any): Promise<VoteResult> {
  const votes = await Promise.all(activeAgents.map(a => a.evaluate(decision, context)));
  const yes = votes.filter(v => v === 'approve').length;
  const quorum = Math.ceil(activeAgents.length / 2);
  return yes >= quorum ? 'approved' : 'rejected';
}
```

**Shared knowledge broadcasting:** When one agent learns something new (via the Knowledge Extractor), it broadcasts to all active agents in the same swarm via the Event Bus. This prevents agents from duplicating research.

#### MCP Ecosystem
**File:** `assets/extensions/subagents/src/swarm/`
**Role:** MCP (Model Context Protocol) server lifecycle management.

**Managed servers (from `mcp-servers.json`):**
```json
{
  "filesystem": { "command": "npx", "args": ["@modelcontextprotocol/server-filesystem", "/"] },
  "github": { "command": "npx", "args": ["@modelcontextprotocol/server-github"] },
  "postgres": { "command": "npx", "args": ["@modelcontextprotocol/server-postgres"] }
}
```

**MCP command allowlist** (security — hardcoded, not configurable):
- `npx`, `node`, `uvx`, `python3`, `deno`, `bun`

**Auto-discovery:** Scans npm registry for packages matching `@modelcontextprotocol/server-*` and `mcp-*`. Presents new servers to the user for optional installation.

---

### Phase 5 — Execution (Muscles)

#### Full-Stack Generator
**File:** `assets/extensions/subagents/src/execution/`
**Role:** Generate complete runnable projects from a specification.

**Generated artefacts:**
- `package.json` with all necessary dependencies
- Database schema (`schema.sql`) + migrations (`migrations/001_initial.sql`)
- JWT authentication middleware
- REST API (Express or Fastify, based on spec)
- React frontend with basic routing and auth
- `Dockerfile` + `docker-compose.yml`
- GitHub Actions CI pipeline (`.github/workflows/ci.yml`)
- `README.md` with setup instructions

**Triggered by:** User request "generate a full-stack app for X" or `decompose_goal` creating a `GENERATE_PROJECT` sub-task.

#### Database Intelligence
**File:** `assets/extensions/subagents/src/execution/`
**Role:** SQLite analysis, index optimisation, and migration management.

**Capabilities:**
- Schema analysis: table structures, column types, constraints
- Index usage analysis: identify missing indexes using `EXPLAIN QUERY PLAN`
- Query performance: run `EXPLAIN` on slow queries and suggest optimisations
- Migration manager: numbered SQL files, tracked in `_migrations` table, rollback support
- Automated backup: gzip-compressed SQLite dumps with configurable retention

---

### Phase 6 — Self-Evolution (Metamorphosis)

#### Self-Modifier
**File:** `assets/extensions/subagents/src/evolution/`
**Role:** Propose and apply patches to custom-pi's own source code.

**⚠️ CRITICAL SAFETY RULE:** Self-modification MUST go through the approval gate. See IMPROVEMENTS.md §7.4 for the required implementation.

**Safe modification pipeline (current + intended):**
1. Agent identifies an improvement opportunity
2. Agent generates a git-format diff
3. **[REQUIRED — NOT YET FULLY IMPLEMENTED]** Diff presented to user for review
4. User approves
5. Backup created: `checkpoints/pre-mod-{timestamp}.tar.gz`
6. Patch applied
7. `npx tsc --noEmit` run — rollback on failure
8. `npx vitest run` run — rollback on failure
9. Change committed with message "chore: self-modification — {description}"

**Rollback command:** `custom-pi /rollback {checkpoint-id}`

#### Continuous Learning
**File:** `assets/extensions/subagents/src/evolution/`
**Role:** Learn from user corrections and tool outcomes.

**Learning sources:**
- User corrections: "No, that's wrong — the correct approach is X" → negative example stored
- Tool success patterns: which tool sequence leads to task completion
- Tool failure patterns: which approaches consistently fail for which task types
- Correction rate tracking: overall and per-category

**Knowledge consolidation:** Weekly batch job (run by daemon) that:
1. Aggregates all corrections from the past week
2. Identifies recurring patterns
3. Updates the prompt library with improved examples
4. Calculates per-strategy success rates for the Metacognition subsystem

---

### Phase 7 — Omega (Advanced Cognition)

#### Long-Term Planner
**File:** `assets/extensions/subagents/src/omega/`
**Role:** Multi-horizon goal planning with milestone tracking.

**Planning horizons:**
- Immediate (hours): current task completion
- Short-term (days): sprint goals, feature milestones
- Medium-term (weeks): release goals, refactoring targets
- Long-term (months): architectural evolution, adoption milestones

**Milestone schema:**
```typescript
interface Milestone {
  id: string;
  horizon: 'hours' | 'days' | 'weeks' | 'months';
  description: string;
  status: 'not_started' | 'in_progress' | 'blocked' | 'complete' | 'cancelled';
  successCriteria: string[];
  blockers: string[];
  estimatedCompletionDate: number;
  riskScore: number;    // 0.0-1.0
}
```

**Risk forecasting:** Uses causal graph to identify which current blockers are likely to impact future milestones.

#### Causal Reasoner
**File:** `assets/extensions/subagents/src/omega/`
**Role:** Root cause analysis and counterfactual evaluation.

**Causal graph structure:** Stored in the State Graph as directed edges with `predicate: 'causes' | 'prevents' | 'correlates_with'`.

**Root cause analysis (`causal_analyze` tool):**
1. Take a failure/problem as input
2. Query the State Graph for all events preceding the failure
3. Apply the PC Algorithm to identify causal links vs. correlations
4. Output a causal chain from root cause to symptom
5. Suggest intervention points

**Counterfactual evaluation:**
- User question: "What if we had used PostgreSQL instead of SQLite?"
- Causal Reasoner identifies all nodes in the State Graph that have `predicate: 'depends_on' → 'sqlite'`
- Simulates the counterfactual by substituting nodes
- Outputs predicted outcomes vs. actual outcomes

#### Universal Tool Creator
**File:** `assets/extensions/subagents/src/omega/`
**Role:** Generate tool bindings from API specifications.

**Input:** OpenAPI spec, GraphQL schema, or README documentation
**Output:** A complete tool definition usable by any agent, persisted to the tool registry

**Generated tool structure:**
```typescript
{
  name: "stripe_create_payment",
  description: "Create a new payment intent",
  inputSchema: { type: "object", properties: { amount: { type: "number" }, currency: { type: "string" } }, required: ["amount", "currency"] },
  execute: async (input) => {
    const key = await vault.get('STRIPE_API_KEY');
    return await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: new URLSearchParams({ amount: input.amount, currency: input.currency })
    });
  }
}
```

---

### Phase 8 — Transcendence

#### Plugin Marketplace
**File:** `assets/extensions/subagents/src/plugin-system/`
**Role:** Install, manage, and sandbox third-party plugins.

**Installation sources:** npm packages, GitHub repositories, local file paths.

**Plugin lifecycle hooks:**
```typescript
interface PluginHooks {
  'before_tool_call': (toolName: string, input: any) => Promise<void>;
  'after_tool_call': (toolName: string, input: any, output: any) => Promise<void>;
  'before_message': (message: string) => Promise<string>;    // Can transform message
  'after_message': (message: string, response: string) => Promise<void>;
  'on_session_start': (ctx: SessionContext) => Promise<void>;
  'on_session_end': (ctx: SessionContext, summary: string) => Promise<void>;
}
```

**Sandboxing:** See IMPROVEMENTS.md §8.2 for the required Worker Thread upgrade. Current sandbox uses `Object.create(null)` with an `ALLOWED_HOOK_NAMES` allowlist.

**Plugin registry (`~/.pi/agent/plugins/registry.json`):**
```json
{
  "obsidian-sync": {
    "source": "npm:@custom-pi/plugin-obsidian",
    "version": "1.2.0",
    "hooks": ["after_message"],
    "enabled": true
  }
}
```

---

## 5. TOOL ARSENAL — 40+ TOOLS

All tools are defined in `assets/extensions/subagents/src/index.ts` (pending split into `tools/` directory — see IMPROVEMENTS.md §1.2).

### Media Synthesis

| Tool | Description | Input | Output |
|---|---|---|---|
| `generate_image` | Free AI image gen via Pollinations.ai | `{prompt, provider?, count?, seed?}` | `{filenames: string[], assetDir: string}` |
| `request_asset_selection` | Show image picker modal in Web UI | `{filenames: string[], prompt: string}` | `{selected: string}` |
| `text_to_speech` | Edge-TTS → audio buffer | `{text, voice?, language?}` | `{audio: Buffer, duration: number}` |
| `render_mermaid` | Compile Mermaid diagram to SVG | `{diagram: string}` | `{svg: string, ascii?: string}` |

**`generate_image` providers:**
- `"free"` (default): Pollinations.ai — Flux, GPT Image, Seedream models. Zero cost.
- `"designapi"`: Requires `DESIGN_API_KEY` in vault. Access to Flux Pro, DALL-E 3, Recraft v3, Ideogram.

### Social & Broadcast

| Tool | Description | Auth |
|---|---|---|
| `request_post_approval` | Show formatted preview, get user approval | None (Web UI modal) |
| `post_to_twitter` | Tweet with optional image | Browser cookie (Playwright) |
| `post_to_reddit` | Submit post to subreddit | Browser cookie (Playwright) |
| `post_to_bluesky` | Publish text update | Browser cookie (Playwright) |
| `post_to_discord` | Send message to channel | Bot token or webhook (vault) |
| `post_to_telegram` | Send to Telegram channel | Bot token (vault) |

**Browser auth flow:** On first use of any browser-based social tool, Playwright opens a visible browser window for manual login. Cookies are persisted to `~/.pi/agent/.playwright/` for subsequent runs. Sessions typically last 30 days.

### Knowledge & Memory

| Tool | Description |
|---|---|
| `memory_store` | Store a fact or observation in TF-IDF vector memory |
| `memory_search` | Semantic search over stored memories |
| `memory_edit` | Update or correct an existing memory entry |
| `vault_set` | Store an encrypted credential |
| `vault_get` | Retrieve an encrypted credential |
| `vault_delete` | Delete a vault entry |
| `vault_list` | List all vault keys (values never shown) |
| `vault_import` | Import credentials from a `.env` file |

### Search & Web

| Tool | Description |
|---|---|
| `web_search` | Multi-tier search: DuckDuckGo → Algolia → Wikipedia |
| `web_fetch` | Fetch a URL with HTML-to-Markdown conversion |
| `internal_url` | Route `memory://`, `vault://`, `local://` URLs to correct handler |

**`web_search` fallback chain:**
1. DuckDuckGo Lite (no API key required)
2. Algolia (if `ALGOLIA_API_KEY` in vault)
3. Wikipedia API (for factual queries)

### Browser & Shell

| Tool | Description | Security |
|---|---|---|
| `browser` | Headless Chromium: navigate, click, type, screenshot, extract | SSRF prevention via `isPrivateUrl()` |
| `bash` | Execute shell commands | 60+ command allowlist, no shell injection, segment-aware piping |
| `ssh_exec` | Remote command execution | `sshpass -e` (env var), key-based auth preferred |

**`bash` allowlist (key entries):**
```
ls, cat, grep, find, echo, mkdir, cp, mv, rm (with confirmation), chmod,
git, npm, npx, node, python3, pip, tsc, vitest, docker, curl, wget,
jq, sed, awk, sort, uniq, head, tail, wc, diff, patch, tar, gzip
```

**Blocked:** `sudo`, `su`, `eval`, `exec`, `source`, script execution from untrusted paths.

### Code Intelligence

| Tool | Description |
|---|---|
| `lsp` | Language Server Protocol: hover, symbols, rename, diagnostics, go-to-definition |
| `ast_grep` | Structural syntax search across 11 languages (JS, TS, Python, Go, Rust, Java, ...) |
| `hashline_edit` | Content-hash validated file editing — prevents write conflicts |

**`lsp` supported languages** (via `lsp-servers.json`):
- TypeScript/JavaScript: `typescript-language-server`
- Python: `pyright`
- Go: `gopls`
- Rust: `rust-analyzer`
- Java: `eclipse.jdt.ls`

### Integrations

| Tool | Description | Auth |
|---|---|---|
| `github` | Full GitHub API: issues, PRs, code search, webhooks | `GITHUB_TOKEN` in vault |
| `send_email` | Gmail via OAuth 2.0 Device Flow | OAuth token stored in vault |
| `plugin` | Dynamic JavaScript extension execution | Sandboxed |

### Ascension Tools

| Tool | Description |
|---|---|
| `initialize_ascension` | Boot all 26 subsystems |
| `shutdown_ascension` | Gracefully stop all subsystems, persist state |
| `decompose_goal` | Break a high-level goal into DAG of sub-tasks |
| `long_term_plan` | Generate multi-horizon roadmap with milestones |
| `causal_analyze` | Root cause analysis and counterfactual evaluation |
| `create_tool` | Generate a tool binding from an API spec or README |

### Orchestration

| Tool | Description |
|---|---|
| `plan` | Create and track multi-step checklists |
| `session` | Checkpoint serialisation: save/restore session state |
| `todo_write` | Write structured task lists |
| `search_past_sessions` | Cross-session memory search via archived Markdown files |

---

## 6. DAG SWARM CONFIGURATION

**File:** `~/.pi/agent/dag-config.yaml`

### Schema

```yaml
version: 1
mode: pipeline | parallel | sequential
pipeline_count: integer    # For 'pipeline' mode: number of iterations
agents:
  - id: string              # Unique identifier within this DAG
    role: string            # Natural language description of this agent's job
    tools: [string]         # Tool names this agent can use
    waits_for: [string]     # IDs of agents that must complete first
    system_prompt: string   # Optional: override the default system prompt
    model: string           # Optional: use a specific model for this agent
    max_tokens: integer     # Optional: limit this agent's context
```

### Execution Modes

**`pipeline` mode:**
- Agents run in dependency order (topological sort)
- CEO orchestrator monitors all agents
- On completion, the last agent's output is reviewed by the first agent (loop)
- `pipeline_count` limits the number of iterations
- Best for: code review loops (coder → reviewer → coder → reviewer...)

**`parallel` mode:**
- All agents with no dependencies run simultaneously
- Agents with `waits_for` run when their dependencies complete
- Best for: PR reviews (multiple independent reviewers)
- ⚠️ File write conflicts possible — use different output directories

**`sequential` mode:**
- Strict single-lane execution
- Each agent must fully complete before the next starts
- Best for: safety-critical pipelines where parallelism risks are unacceptable

### Validation Rules (enforced on swarm start)

1. All IDs are unique
2. `waits_for` references only valid IDs
3. No cycles in the dependency graph
4. All tool names exist in the tool registry
5. If `model` is specified, it must exist in `models.json`

---

## 7. HIVE MIND — DYNAMIC TEAMS

The Hive Mind is different from DAG Swarms. DAG Swarms are statically configured in YAML. The Hive Mind dynamically forms teams at runtime based on task requirements.

### Team Formation

```typescript
// User goal: "Deploy a full-stack app with monitoring"
// Hive Mind analysis:
const requiredCapabilities = [
  'architecture_design',    // → architect agent
  'backend_development',    // → backend-dev agent
  'frontend_development',   // → frontend-dev agent
  'devops',                 // → devops agent
  'security_review',        // → security-reviewer agent
];

const team = hive.formTeam(requiredCapabilities);
// → Team: [architect, backend-dev, frontend-dev, devops, security-reviewer]
```

### Shared State Between Hive Agents

All agents in a Hive team share a namespace in the State Graph:
```
nodes: type = 'hive_artifact', properties.team_id = 'team-{timestamp}'
```

Any agent can read/write to this namespace. Writes are atomic (WAL mode). The CEO monitors the namespace and synthesises the final output.

### Consensus Voting

For decisions tagged as `CriticalDecision`, all active agents in the team vote:

```
Decision: "Should we deploy to production?"
Votes:
  architect:    APPROVE (all integration tests pass)
  backend-dev:  APPROVE (API endpoints healthy)
  devops:       APPROVE (staging smoke tests green)
  security:     REJECT  (one medium-severity finding unresolved)
  frontend-dev: APPROVE

Result: 4 APPROVE, 1 REJECT → REJECTED (majority required, not unanimous)
Action: Block deployment, notify user, show security finding
```

Configurable: `require_unanimous: true` for extra-critical decisions (e.g., database schema changes in production).

---

## 8. MEMORY ARCHITECTURE

### The Three Tiers

```
Tier 1: Episodic Memory (WHAT HAPPENED)
  │ Stores: Sessions, successes, failures with emotional valence
  │ Backend: SQLite table `episodes`
  │ Retrieval: Similarity search over episode summaries
  └── Dream Consolidation: Offline replay during idle, compresses old episodes to gist

Tier 2: Hybrid Search (WHAT DO WE KNOW)
  │ Stores: Facts, concepts, code patterns, documentation
  │ Backend: SQLite FTS5 (BM25) + in-memory dense vectors + State Graph
  │ Retrieval: Four-strategy fusion (BM25 + Dense + Graph + Cross-encoder)
  └── Memory TTL: 7 days (transient) to 5 years (core knowledge)

Tier 3: Knowledge Graph (HOW THINGS RELATE)
  │ Stores: (Subject) → [Predicate] → (Object) triplets
  │ Backend: SQLite property graph (state-graph.db)
  │ Retrieval: Path-finding, neighbor traversal, confidence filtering
  └── Auto-Learning: LLM extracts triplets from tool outputs every 5 min
```

### Memory TTL Policy

| Entity Type | TTL | Rationale |
|---|---|---|
| Transient tool outputs | 7 days | Short-lived implementation details |
| Code-specific facts | 30 days | Code changes frequently |
| Architecture decisions | 1 year | Stable but not permanent |
| User preferences | 5 years | Core to personalisation |
| Agent identity facts | Never | SOUL.md-derived knowledge |

### Context Recall Priority

When the agent needs memory context for a new query, it queries in this order:

1. **Intent classification** → determines which tier to query first
2. **FTS5 chat history** → recent conversation context
3. **Knowledge graph triplets** → factual relationships
4. **Episodic memory** → similar past situations
5. **Fallback** → no memory context found, proceed with base knowledge

---

## 9. EVENT BUS — THE NERVOUS SYSTEM

**File:** `assets/extensions/subagents/src/event-bus/`

All inter-subsystem communication goes through the Event Bus. Never call subsystem methods directly.

### Key Event Topics (70+)

| Topic | Publisher | Subscribers |
|---|---|---|
| `tool.start` | Tool executor | Metacognition, Financial Autonomy, Telemetry |
| `tool.end` | Tool executor | Metacognition, Knowledge Extractor, Cost Tracker |
| `tool.error` | Tool executor | Self-Healer, Episodic Memory |
| `memory.store` | Any agent | Knowledge Extractor |
| `memory.extract` | Knowledge Extractor | State Graph |
| `health.check` | Self-Healer | All subsystems (for status) |
| `health.fail` | Self-Healer | Initiative Engine, Daemon |
| `swarm.agent_start` | Swarm coordinator | Hive Mind, Telemetry |
| `swarm.agent_done` | Agent | Swarm coordinator, State Graph |
| `swarm.agent_fail` | Agent | Swarm coordinator, Episodic Memory |
| `env.file_changed` | Environment Sensor | Knowledge Extractor |
| `env.git_dirty` | Environment Sensor | Initiative Engine |
| `initiative.opportunity` | Initiative Engine | CEO (for proactive suggestions) |
| `security.finding` | Security Autopilot | Dashboard, CEO |
| `budget.threshold` | Financial Autonomy | CEO, Daemon |
| `webhook.received` | Webhook listener | CEO, Deployment Orchestrator |
| `web.trend` | Web Sentience | Social Media swarm |

### Event Schema

```typescript
interface AgentEvent<T = any> {
  id: string;                    // UUID
  topic: string;                 // Dot-separated topic path
  correlationId: string;         // Trace ID linking related events
  timestamp: number;             // Unix timestamp (ms)
  payload: T;                    // Event-specific data
  source: string;                // Subsystem that emitted this event
  sessionId?: string;            // If within an active session
}
```

### Middleware

The Event Bus supports middleware that runs before delivery:

```typescript
eventBus.use(async (event, next) => {
  // Example: log all events to the telemetry pipeline
  await telemetry.record(event);
  await next();
});

eventBus.use(async (event, next) => {
  // Example: redact sensitive data before broadcasting over WebSocket
  if (event.topic.startsWith('vault.')) {
    event.payload = { ...event.payload, value: '[REDACTED]' };
  }
  await next();
});
```

---

## 10. STATE GRAPH — THE PROPERTY GRAPH DATABASE

**File:** `~/.pi/agent/state-graph.db`

The State Graph is the single source of truth for all agent state. Every meaningful fact the agent learns goes here.

### Node Types

| Type | Examples |
|---|---|
| `tool` | `web_search`, `bash`, `generate_image` |
| `file` | `src/index.ts`, `package.json` |
| `function` | `createApp()`, `withSwarmLock()` |
| `class` | `EpisodicMemory`, `GoalDecomposer` |
| `concept` | `authentication`, `rate-limiting`, `deployment` |
| `dependency` | `fastify@5`, `react@18`, `better-sqlite3@12` |
| `setting` | `contextWindow`, `compaction.enabled` |
| `person` | `@IamNishant51`, external collaborators |

### Common Predicates

| Predicate | Example |
|---|---|
| `uses` | `custom-pi → uses → fastify` |
| `depends_on` | `web-server.mjs → depends_on → fastify` |
| `has_tool` | `ceo-agent → has_tool → web_search` |
| `caused_by` | `deploy_failure → caused_by → test_timeout` |
| `extends` | `custom-pi → extends → pi-coding-agent` |
| `built_with` | `custom-pi → built_with → typescript` |
| `knows_about` | `ceo-agent → knows_about → jwt-authentication` |
| `authored_by` | `custom-pi → authored_by → @IamNishant51` |

### Querying the Graph

In agent conversation:
```
/triplets                    → list top 20 triplets by confidence
/triplets fastify            → all triplets involving "fastify"
/triplets --graph fastify    → ASCII graph centered on "fastify" (not yet implemented)
```

Via tool:
```typescript
await ctx.callTool('causal_analyze', {
  query: 'Why did the deployment fail?',
  context: 'deployment timestamp: 2026-06-24T18:00:00Z'
});
```

---

## 11. BACKGROUND DAEMON

**File:** `assets/extensions/subagents/src/daemon/daemon.ts`
**Binary:** `custom-pi /daemon start|stop|status`

The daemon is a separate Node.js process that:
1. Watches for idle periods (CPU < 10% for 30+ minutes)
2. Runs scheduled background tasks (see §4, Phase 0)
3. Persists heartbeat to SQLite every 30 seconds
4. Cleans up on `SIGTERM` / `SIGINT`

**Inter-process communication:** The daemon communicates with the CLI/Web process via SQLite (poll-based, not socket-based). The Web UI polls `/api/daemon/status` every 30 seconds.

**Starting automatically:** The daemon can be started on login by enabling the systemd service:
```bash
# On Linux with systemd:
cp pi-custom-pack.service ~/.config/systemd/user/
systemctl --user enable pi-custom-pack.service
systemctl --user start pi-custom-pack.service
```

---

## 12. MCP ECOSYSTEM

**File:** `~/.pi/agent/mcp-servers.json`

MCP (Model Context Protocol) allows connecting custom-pi to external services that expose tools and resources.

### Pre-configured Servers

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["@modelcontextprotocol/server-filesystem", "/"]
  },
  "github": {
    "command": "npx",
    "args": ["@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${vault:GITHUB_TOKEN}" }
  },
  "brave-search": {
    "command": "npx",
    "args": ["@modelcontextprotocol/server-brave-search"],
    "env": { "BRAVE_API_KEY": "${vault:BRAVE_API_KEY}" }
  }
}
```

### Adding a New MCP Server

1. Install: `npx @modelcontextprotocol/server-{name}`
2. Add to `mcp-servers.json`
3. Restart custom-pi (or use `/daemon restart-mcp`)
4. The server's tools are auto-discovered and available to all agents

### Security Note

Only MCP servers using commands in the allowlist (`npx`, `node`, `uvx`, `python3`, `deno`, `bun`) will be started. Any server using an unlisted command is silently rejected with a warning.

---

## 13. PLUGIN SYSTEM — PHASE 8

**File:** `assets/extensions/subagents/src/plugin-system/`
**Registry:** `~/.pi/agent/plugins/`

### Installing Plugins

```bash
# From npm:
custom-pi /plugin install @custom-pi/plugin-obsidian

# From GitHub:
custom-pi /plugin install github:IamNishant51/custom-pi-plugin-jira

# From local path:
custom-pi /plugin install ./my-plugin/

# List installed:
custom-pi /plugin list

# Remove:
custom-pi /plugin remove plugin-name
```

### Writing a Plugin

```typescript
// my-plugin/index.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  hooks: {
    // Called before every message the user sends
    async before_message(message) {
      // Can modify the message
      return message;
    },
    
    // Called after every agent response
    async after_message(message, response) {
      // Log to external service, trigger webhooks, etc.
      await fetch('https://my-service.com/log', {
        method: 'POST',
        body: JSON.stringify({ message, response })
      });
    },
    
    // Called before a tool is executed
    async before_tool_call(toolName, input) {
      if (toolName === 'bash' && input.command.includes('rm -rf')) {
        throw new Error('Plugin blocked dangerous command');
      }
    }
  }
};
```

**Sandbox restrictions:**
- No `require('child_process')`, `require('fs')`, `require('net')` (see IMPROVEMENTS.md §8.2 for Worker Thread upgrade)
- Timeout: 5 seconds per hook invocation
- Memory limit: 64MB per plugin execution
- No access to vault, SSH keys, or browser cookies

---

## 14. SOUL.MD & SYSTEM.MD — IDENTITY LAYER

### SOUL.md

**Location:** `~/.pi/agent/SOUL.md`
**Purpose:** Defines who the agent is. Injected into every session as part of the system prompt.

**Default structure:**
```markdown
# Agent Identity

## Name
Hermes × Paperclip — custom-pi

## Personality
Swift like Hermes, relentless like the Paperclip Maximizer.
I communicate with precision and urgency. I prefer action over analysis.
I ask one clarifying question when necessary, then execute.

## Core Values
- Correctness above speed
- Transparency in actions taken
- Never modify production without explicit confirmation
- Always explain what I'm about to do before doing it

## Communication Style
- Technical users: use exact terminology, skip basics
- Non-technical users: use analogies, avoid jargon
- When frustrated user detected: slow down, simplify, empathise

## Expertise Areas
- TypeScript, Node.js, React, Fastify
- SQLite, database design, query optimisation
- AI agent architectures, LLM prompt engineering
- DevOps, Docker, GitHub Actions
- Security: OWASP, secret management, auth patterns
```

**Customising:** Edit `~/.pi/agent/SOUL.md` to change the agent's name, personality, values, and communication style. Changes take effect on the next session start.

### SYSTEM.md

**Location:** `~/.pi/agent/SYSTEM.md`
**Purpose:** Defines the hard rules the agent must follow. More authoritative than SOUL.md.

**Key rules (do not remove):**
- Never commit or push without explicit user confirmation
- Never delete files without confirmation (exceptions: temp files in `/tmp/`)
- Always explain what a bash command does before executing it
- Never store secrets in plain text (always use vault)
- When uncertain about a destructive action, ask
- Format all code in markdown code blocks with language tag
- Report errors with full context, not just the error message

---

## 15. WRITING NEW AGENTS

### Step 1: Define the Agent in YAML

Create `assets/agents/my-agent.yaml`:
```yaml
id: my-agent
name: "My Specialist Agent"
role: "Handle X, Y, and Z tasks"
tools:
  - web_search
  - write
  - bash
system_prompt: |
  You are a specialist in X. Your job is to Y.
  Always Z before taking action.
  Report results in this format:
  ## Summary
  ## Actions Taken
  ## Next Steps
```

### Step 2: Register in Hive Mind Capabilities

Add to `assets/extensions/subagents/src/swarm/capabilities.ts`:
```typescript
const AGENT_CAPABILITIES: Record<string, string[]> = {
  'my-agent': ['capability_x', 'capability_y', 'capability_z'],
  // ... existing agents
};
```

### Step 3: Test the Agent

```bash
# Start a swarm with just your new agent:
cat > /tmp/test-dag.yaml << EOF
version: 1
mode: sequential
agents:
  - id: my-agent
    role: Test my new agent
    tools: [web_search, write]
    waits_for: []
EOF

# Launch the test swarm via Web UI → Swarm Commander → Load Config
```

### Step 4: Add DAG Config (if needed)

Add to `~/.pi/agent/dag-config.yaml` for use in production swarms.

### Agent Design Principles

1. **Single responsibility:** Each agent should do one thing well.
2. **Explicit tools list:** Only include tools the agent actually needs. More tools = more token usage.
3. **Clear output format:** Define exactly how the agent should format its output so downstream agents can parse it reliably.
4. **Idempotent when possible:** Design agents so re-running them is safe.
5. **Error reporting:** Agents should report failures with enough context for the CEO to re-plan.

---

## 16. WRITING NEW TOOLS

**Location (current):** `assets/extensions/subagents/src/index.ts`
**Location (target):** `assets/extensions/subagents/src/tools/my-tool.ts`

### Tool Definition Structure

```typescript
import type { ToolDefinition, ToolContext } from '../types/tools';

interface MyToolInput {
  param1: string;
  param2?: number;
}

interface MyToolOutput {
  result: string;
  metadata: Record<string, any>;
}

export const myTool: ToolDefinition<MyToolInput, MyToolOutput> = {
  name: 'my_tool',
  description: `
    One-sentence description of what this tool does.
    
    Use this tool when: [specific conditions]
    Do NOT use this tool when: [anti-patterns]
    
    Returns: [description of output structure]
  `,
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'What param1 means' },
      param2: { type: 'number', description: 'What param2 means', default: 10 }
    },
    required: ['param1']
  },
  execute: async (input: MyToolInput, ctx: ToolContext): Promise<MyToolOutput> => {
    // 1. Validate input beyond JSON schema
    if (input.param1.length > 1000) {
      throw new ToolError('param1 too long (max 1000 chars)', 'VALIDATION_ERROR');
    }
    
    // 2. Check budget / rate limits
    await ctx.checkBudget({ estimatedTokens: 500 });
    
    // 3. Core logic
    const result = await doTheWork(input);
    
    // 4. Emit event for observability
    ctx.eventBus.emit('tool.my_tool.executed', { input, result });
    
    // 5. Store result in knowledge graph if significant
    if (result.metadata.significant) {
      await ctx.stateGraph.upsertTriplet({
        subject: input.param1,
        predicate: 'produced',
        object: result.result,
        confidence: 0.9
      });
    }
    
    return result;
  }
};
```

### Tool Design Principles

1. **Fail loudly with context:** Throw `ToolError` with a `code` field, not generic `Error`.
2. **Always emit events:** `tool.start` and `tool.end` are emitted by the executor, but tool-specific events should be emitted by the tool itself.
3. **Respect budget:** Call `ctx.checkBudget()` before expensive LLM calls inside a tool.
4. **Return structured data:** Don't return raw strings. Return typed objects that downstream tools and agents can parse.
5. **Validate inputs:** JSON schema validation happens before `execute()` but add semantic validation inside.
6. **Idempotent reads, careful writes:** Read operations should always be safe to retry. Write operations need confirmation gates.

---

## 17. AGENT COMMUNICATION PROTOCOLS

### Direct Message (CEO → Sub-Agent)

The CEO passes a goal/task string to a sub-agent. The sub-agent has access to the same State Graph namespace. No direct API call — the CEO writes the task to the shared namespace, the sub-agent polls for it.

### Event Bus (Broadcast)

Used for notifications that any interested party should receive. No point-to-point messaging — any subscriber will receive it.

### File Handoff (Agent → Agent)

For large artifacts (code files, research docs), agents write to a shared file path and the next agent reads it:
```
~/.pi/agent/swarm/{swarm-id}/{step-name}/output.md
```
This is the primary communication mechanism in DAG Swarms (e.g., researcher writes a brief, writer reads it).

### State Graph Handoff (Agent → Agent)

For structured data (triplets, facts, metrics), agents write to the State Graph:
```typescript
// Researcher writes:
await stateGraph.upsertNode({ id: 'research-{taskId}', type: 'artifact', properties: { findings: '...' } });

// Writer reads:
const research = await stateGraph.getNode('research-{taskId}');
```

---

## 18. AGENT LIFECYCLE & ERROR RECOVERY

### Normal Lifecycle

```
INITIALISE → READ_CONTEXT → PLAN → EXECUTE → REPORT → SHUTDOWN
```

### Error States

| Error | Recovery Strategy |
|---|---|
| Tool timeout | Retry with exponential backoff (3 attempts). If all fail → report failure to CEO. |
| LLM API error | Switch to fallback model (see Financial Autonomy). |
| File conflict | Use advisory file lock (`withFileLock`). Wait up to 30s, then fail. |
| Memory full (context) | Trigger `session.compact()`. If still full → summarise and continue. |
| Sub-agent crash | CEO detects missing `swarm.agent_done` event. Re-assign task to a new agent. |
| Consensus quorum fail | Wait 30s, retry once. If still no quorum → escalate to CEO, which asks user. |

### ESC Key Behavior (TUI)

In the TUI, pressing `ESC`:
1. Immediately sends `SIGTERM` to the Pi Agent's current tool invocation (using `AbortSignal`)
2. Broadcasts `swarm.emergency_stop` event to all active sub-agents
3. Each sub-agent receives the event and calls `gracefulShutdown()` within 5 seconds
4. State is checkpointed before shutdown

---

## 19. SECURITY RULES FOR AGENTS

These rules apply to ALL agents and tools. They are enforced at the platform level and cannot be overridden by SOUL.md or SYSTEM.md.

### Mandatory Approval Gates

The following actions ALWAYS require user confirmation, regardless of trust level:

- Any `bash` command containing `rm -rf`, `dd if=`, `mkfs`, `format`
- Any `ssh_exec` command on production hosts
- `post_to_*` on any social platform
- `send_email` to any recipient
- `vault_delete` for any key
- `self_modify` (any patch to custom-pi's own source)
- `deploy_to_production` in the Deployment Orchestrator

### Security Boundaries

- Agents cannot read or write to the `.vault/` directory directly — only via `vault_*` tools
- Agents cannot access `master.key` via any tool
- The `browser` tool cannot navigate to `localhost`, `127.0.0.1`, or RFC 1918 addresses
- The `bash` tool cannot use shell injection patterns (`;`, `&&`, `||` between commands is checked)
- Plugin hooks cannot make network requests (blocked at sandbox level)

### Authentication for Web API

All Web UI API calls require authentication via one of:
- Bearer token: `Authorization: Bearer {PI_API_KEY}`
- API key header: `X-Api-Key: {PI_API_KEY}`
- WebSocket query: `ws://localhost:4321?token={PI_API_KEY}`

All comparisons use `crypto.timingSafeEqual` to prevent timing attacks.

---

## 20. PLANNED FUTURE AGENTS

These agents are designed but not yet implemented. Add them in this order.

### Next Quarter

**`refactor-agent`**
- Role: Autonomous codebase refactoring with safety checks
- Tools: `read`, `ast_grep`, `lsp`, `hashline_edit`, `bash`
- Output: Refactored code with before/after diff, test results
- Safety: Only runs when git is clean, always creates a branch first

**`documentation-agent`**
- Role: Generate and maintain documentation from source code
- Tools: `read`, `lsp`, `write`, `glob`
- Output: JSDoc comments, README sections, API docs
- Trigger: `env.file_changed` on source files

**`performance-agent`**
- Role: Identify and fix performance bottlenecks
- Tools: `bash`, `lsp`, `web_search`, `write`
- Output: Performance report with before/after benchmarks
- Trigger: Lighthouse CI score drops below threshold

### Future Vision

**`multi-user-coordinator`**
- Role: Coordinate work across multiple users' agents in a shared workspace
- Requires: Multi-user WebSocket rooms, presence system, conflict resolution

**`fine-tuning-agent`**
- Role: Prepare and submit LoRA fine-tuning jobs using user corrections
- Requires: GPU access, `peft` / `unsloth` Python environment

**`wake-word-agent`**
- Role: Listen for "Hey Custom-PI" and activate the agent
- Requires: Always-on microphone access, local Whisper model for wake-word

**`mobile-agent`**
- Role: Serve the Web UI to mobile devices with touch-optimised UX
- Requires: Capacitor packaging, push notification integration

---

*This document should be updated with every new agent, tool, or subsystem addition. If you're an AI agent reading this: follow every rule in this file exactly. If you find a conflict between this file and SOUL.md/SYSTEM.md, this file wins for architectural decisions. SOUL.md wins for personality. SYSTEM.md wins for safety.*
