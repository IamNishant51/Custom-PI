# custom-pi

<p align="center">
  <img src="assets/custom-pi-ascii-logo.svg" alt="custom-pi logo" width="750" />
</p>

<p align="center">
  <b>An ultra-premium, responsive wrapper and extension suite for the core Pi Coding Agent.</b>
  <br/>
  <i>Self-improving. Context-aware. Unforgetting.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/custom-pi"><img src="https://img.shields.io/npm/v/custom-pi.svg?style=for-the-badge&color=ff007f&logo=npm" alt="NPM Version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-a122ff.svg?style=for-the-badge" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-00f0ff.svg?style=for-the-badge&logo=node.js" alt="Node Version" /></a>
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/RAG-Obsidian-00ffcc.svg?style=for-the-badge&logo=obsidian" alt="RAG Link" /></a>
  <img src="https://img.shields.io/badge/FTS5-Trigram-a100ff.svg?style=for-the-badge" alt="FTS5" />
  <img src="https://img.shields.io/badge/Self--Improving-Yes-00ff88.svg?style=for-the-badge" alt="Self-Improving" />
</p>

---

## ⚡ Overview

`custom-pi` wraps the core Pi Coding Agent with advanced multi-agent orchestrations, real-time telemetry HUD dashboards, long-term memory systems, anti-hijack guardrails, and — now — a full **self-improvement loop** inspired by Hermes Agent. It remembers what it learns, gets better with every session, and never forgets who it is.

> 🧬 **New: Identity Layer** — A `SOUL.md` file defines the agent's core identity, loaded as the very first block in every system prompt. Change it, and you change the agent's fundamental personality.

---

## 🛠️ Key Enhancements

### 1. Parallel Sub-Agent Swarm
Delegate complex engineering, auditing, and research tasks to specialized background agents running concurrently:

| Sub-Agent | Core Specialization & Tools |
| :--- | :--- |
| **`builder`** | Expert Next.js developer equipped to write error-free APIs and frontends. |
| **`researcher`** | Code explorer that traverses directory trees, reads logs, and tracks logic flows. |
| **`reviewer`** | Critical auditor verifying security (OWASP), performance, and WCAG accessibility. |


> [!TIP]
> You can dynamically generate specialized sub-agents on the fly using `/create_subagent` command.

```mermaid
graph TD
    User([User Prompt]) --> CustomPI[custom-pi Core CLI]

    subgraph "🧬 Identity & Context"
        SOUL[SOUL.md Identity Layer]
        MEM[MEMORY.md + USER.md<br/>Curated Facts]
    end

    subgraph "🤖 Agent Runtime"
        CustomPI --> Agent[Pi Coding Agent]
        SOUL --> Agent
        MEM --> Agent
        Agent --> HUD[Quantum HUD Dashboard]
    end

    subgraph "🧠 Background Self-Improvement Loop"
        Agent -->|Every ~10 turns| Nudge[Nudge System]
        Nudge --> Review[Background Review]
        Review -->|New Facts| MEM
        Review -->|New Skills| SKILL[Skills Directory<br/>~/.pi/skills/]
        Review -->|Task State| DB[(SQLite FTS5<br/>Session DB)]
        Nudge -->|6h interval| Curator[Skill Curator]
        Curator -->|Archive stale| SKILL
    end

    subgraph "⚡ Swarm Execution"
        Agent --> Swarm[Sub-Agent Swarm Manager]
        Swarm --> Builder[Builder]
        Swarm --> Researcher[Researcher]
        Swarm --> Reviewer[Reviewer]
    end

    Builder & Researcher & Reviewer --> Tools[Local & Web Tools]
    Tools --> RAG[Obsidian RAG Memory]
    Tools --> Filesystem[Local Filesystem]
    Tools --> Web[Web Search & Fetch]
    DB --> Agent
    SKILL --> Agent
```

### 2. 🧬 SOUL.md — Identity Layer
A markdown file at `~/.pi/agent/SOUL.md` that defines *who the agent is*. Loaded before anything else — no file reads, no memory context, nothing. Just identity.

```
# Custom-PI Identity
You are Custom-PI, a sharp, pragmatic autonomous AI software engineer.
You optimize for usefulness over politeness.
...
```

Change it to make the agent a "React specialist", "security auditor", or "poet" — the identity shifts instantly.

### 3. 🧠 Curated File Memory (MEMORY.md + USER.md)
Two plain-text files that accumulate durable facts across sessions:

- **`MEMORY.md`** — Project/system facts: architecture decisions, integrations, build commands, bug workarounds.
- **`USER.md`** — User preferences: coding style, formatting, communication tone, personal info.

Entries are space-efficient single lines delimited by `§`, with automatic capacity enforcement (2200 chars memory / 1375 chars user). The agent can write, replace, and remove entries using dedicated tools. The background review nudge auto-extracts new facts every ~10 turns.

### 4. 🔄 Nudge-Driven Background Self-Improvement
Forget polling. The system uses **two independent turn counters**:

| Counter | Triggers every | Purpose |
| :--- | :--- | :--- |
| `turnsSinceMemory` | 10 turns | Reviews conversation for new facts → writes to MEMORY.md/USER.md |
| `turnsSinceSkill` | 10 turns | Extracts reusable operation patterns → saves as SKILL.md |

Both run as lightweight `completeSimple()` calls — no forked agents, no overhead. They track independently so a long memory-extraction session doesn't suppress skill discovery.

### 5. 🔧 Skills System — Learn from Experience
When the agent solves complex multi-step tasks (≥5 tool calls), the background review extracts a **skill** — a reusable procedure stored as a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: react-vite-setup
description: Scaffold a React project with Vite, add routing and state management
author: agent
version: 1
tags: [react, vite, frontend]
complexity: 4
---
## Steps
1. Run `npm create vite@latest` with React template
2. Install react-router-dom, zustand
3. Set up BrowserRouter in main.tsx
...
```

Skills live in `~/.pi/skills/agent/` (agent-authored) or `~/.pi/skills/user/` (user-authored). They're **progressively disclosed** — the system prompt includes a one-line summary, and full content loads on demand.

### 6. 🧹 Skill Curator
An LLM-driven curator runs every **6 hours** in the background. It reviews all agent-authored skills and:

- **Archives** skills unused for >90 days
- **Marks stale** skills unused for >30 days
- **Deletes** redundant, low-quality, or contradictory skills

Usage telemetry is tracked in `~/.pi/skills/.skill-usage.json` with counts, session IDs, and success rates.

### 7. 🔍 FTS5 Session Search
The `search_current_session` tool now runs on **SQLite FTS5 with trigram tokenizer** — supporting CJK languages (Chinese, Japanese, Korean) alongside English. Every message is automatically indexed in a `session-state.db` with WAL mode for zero-latency writes. The same DB stores task state checkpoints for crash recovery.

### 8. ⏰ Cron Scheduler
Three background jobs keep the system healthy:

| Job | Interval | What it does |
| :--- | :--- | :--- |
| **Curator** | 6h | Reviews and prunes stale skills |
| **Consolidation** | 1h | Compacts MEMORY.md/USER.md when near capacity |
| **DB Maintenance** | 24h | Closes/reopens SQLite to keep WAL small |

### 9. Quantum Telemetry HUD (Heads-Up Display)
Overhauls the TUI to render a real-time system stats dashboard at the top of your editor:

- CPU load, RAM usage, active RAG connection status
- Live sub-agent tracking (current turns, elapsed time, called tools)
- Cyberpunk double-line unicode borders (`╔ ═ ╗`) that adapt to terminal width
- Displays memory usage percentage, skills count, and swarm activity

### 10. Session Memory & RAG Integration
- **Task State Memory**: Tracks active goals, completed checklists, current subtasks. Updated in the background and injected into every system prompt — eliminates hallucinations after context compaction.
- **Obsidian RAG**: Auto-detects local Obsidian vaults, links memory to `Agent_Memory.md`, persists user facts across sessions.

### 11. Input Sanitization & Anti-Pollution
Protects the LLM against prompt-injection and instruction-hijacking. Files containing design guides or strict rules are treated as **passive data objects** — the agent's focus stays locked to your goals.

### 12. 🔐 Secrets Vault (AES-256-GCM)
An encrypted secrets vault at `~/.pi/agent/.vault/` using AES-256-GCM encryption:
- **Automatic import** from environment variables on session start (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.)
- Tools: `vault_set`, `vault_get`, `vault_delete`, `vault_list`, `vault_health`
- Master key stored at `chmod 600`, vault entries encrypted individually
- Import/export between vault and environment variables

### 13. 💰 Token Cost Tracker & Budget Controls
Tracks every API call's token usage and estimated cost across all sessions:
- Per-model rate table (Anthropic, OpenAI, Google Gemini)
- Session and daily budget limits with configurable warning thresholds (~80%)
- Tools: `budget_config` (get/set limits), `budget_stats` (session or global summary)
- Append-only JSONL log at `~/.pi/agent/costs/session-costs.jsonl`

### 14. 📂 Work Products Tracker

### 15. 🌐 Web UI (Local Web Application)
When `custom-pi` is installed, launch a full web UI alongside the CLI:
- **Chat interface** with streaming LLM responses, tool call visualization, and conversation history
- **Dashboard** with live stats: token usage, cost, sessions, memory entries, model list
- **Secrets Vault manager** — add, reveal, delete encrypted secrets visually
- **Budget panel** — view token/cost stats, configure session/daily limits and warning thresholds
- **Memory browser** — search, store, and browse persistent facts with type/importance filters
- **Work Products viewer** — explore every file the agent created or modified, with action/agent/timestamp
- **Real-time updates** via WebSocket — tool calls, streaming tokens, and agent progress

```bash
# Build the web client (one-time)
npm run build:web

# Launch the web UI (served at http://localhost:4321)
custom-pi web
```
Records every file the agent creates, reads, modifies, or deletes:
- Each entry includes: agent name, action, file path, hash, size, task context
- Filterable by session ID
- Tools: `work_products` (list or summary view)
- JSONL log at `~/.pi/agent/work-products/products.jsonl`

---

## 📦 Installation

```bash
npm install -g custom-pi
```

This auto-syncs all configurations — sub-agents, themes, system prompts, SOUL.md, and extension modules — to `~/.pi/agent/`.

---

## 🚀 Usage

Start the agent in interactive mode from any workspace directory:

```bash
custom-pi
```

### Command Examples:
* **Interactive Mode**: Starts the terminal with the Quantum HUD dashboard loaded.
* **Non-Interactive Tasks**:
  ```bash
  custom-pi -p "review /Desktop/Pi_DESIGN.md using the reviewer agent"
  ```
* **Specific Model Chains**:
  ```bash
  custom-pi --models "gemini/gemini-2.5-flash,gemini/gemini-2.5-pro"
  ```

---

## 💬 Slash Commands

| Command | Description |
| :--- | :--- |
| `/memory` | Displays active task state (goal, checklist, current subtask) |
| `/memory-stats` | Shows persistent memory statistics and recent entries |
| `/memory-reset` | Clears the current session's task state |
| `/consolidate` | Manually triggers memory consolidation (merge, prune, refresh) |
| `/list_subagents` | Lists all active sub-agents and their tool configurations |
| `/help` | Shows available commands and keyboard shortcuts |

**Behind the scenes**, the system also responds to these **agent-callable tools**:
- `memory_store` / `memory_search` / `memory_delete` — Semantic embedding memory
- `memory_write` (add/replace/remove) — Curated MEMORY.md / USER.md entries
- `search_current_session` — FTS5 trigram search across the entire conversation log
- `vault_set` / `vault_get` / `vault_delete` / `vault_list` / `vault_health` — Encrypted secrets vault
- `budget_config` / `budget_stats` — Token cost budget management
- `work_products` — Track files created/modified by the agent

---

## 📁 File Layout

```
~/.pi/agent/
├── SOUL.md                          # Identity layer (slot #1 system prompt)
├── SYSTEM.md                        # System instructions
├── memories/
│   ├── MEMORY.md                    # Durable project facts
│   └── USER.md                      # User preferences
├── skills/
│   ├── agent/                       # Agent-authored SKILL.md files
│   ├── user/                        # User-authored SKILL.md files
│   └── .skill-usage.json            # Usage telemetry
├── session-state.db                 # SQLite FTS5 session search DB
├── agents/                          # Sub-agent configs (builder, researcher, etc.)
├── themes/                          # TUI themes
├── logs/                            # Extension activity logs
├── .vault/                          # Encrypted secrets vault (AES-256-GCM)
├── costs/
│   └── session-costs.jsonl          # Token/cost tracking log
├── work-products/
│   └── products.jsonl               # File change tracking log
├── web/
│   ├── web-server.mjs              # Web UI server (Fastify + WebSocket)
│   └── client/dist/                # Built React frontend
└── extensions/subagents/src/        # Extension source (22 modules)
```

---

## 🔄 Configuration Sync

If you customize settings, system instructions, or sub-agents locally:

1. **Sync local → package assets**:
   ```bash
   cd ~/Desktop/pi-custom-pack
   npm run update-and-publish
   ```
2. **Global update** (all devices):
   ```bash
   npm update -g custom-pi
   ```

---

## 🧪 88 Unit Tests

Every subsystem has dedicated tests:

```
 ✓ soul-loader         — default content, file read/write
 ✓ memory-file-store   — add/replace/remove, consolidation, capacity
 ✓ memory-nudge        — turn counting, interval triggers, independent counters
 ✓ state-db            — SQLite CRUD, FTS5 search, task state, sessions
 ✓ skill-store         — YAML frontmatter, CRUD, usage telemetry
 ✓ skill-retrieval     — token-matching, usage boost, progressive disclosure
 ✓ memory-embedding    — cosine similarity, orthogonality
 ✓ tui-colors          — hex validation, keys
 ✓ secret-vault        — AES-GCM roundtrip, CRUD, health check
 ✓ cost-tracker        — cost recording, budget config, warnings
 ✓ work-products       — file tracking, filtering, clear
 ✓ cron-scheduler      — cron parsing, validation, next-tick, job registration
```

---

## 📄 License

Licensed under the [MIT License](LICENSE).
