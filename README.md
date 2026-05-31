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
  <img src="https://img.shields.io/badge/TF--IDF-Memory-00ff88.svg?style=for-the-badge" alt="TF-IDF Memory" />
  <img src="https://img.shields.io/badge/DAG-Swarm-a100ff.svg?style=for-the-badge" alt="DAG Swarm" />
  <img src="https://img.shields.io/badge/142-Tests-00f0ff.svg?style=for-the-badge" alt="142 Tests" />
</p>

---

## Overview

`custom-pi` wraps the core Pi Coding Agent with a comprehensive suite of tools, integrations, and orchestrations. It provides a full web UI with real-time streaming, multi-agent DAG-based swarm execution, MCP server integration, LSP-powered code intelligence, encrypted secrets vault, TF-IDF semantic memory, browser automation, GitHub integration, social media posting, and more.

---

## Features

### Core Infrastructure

| Feature | Description |
|---------|-------------|
| **Web UI** | React + Vite frontend with Fastify WebSocket server. Real-time streaming LLM responses, tool call visualization, swarm execution dashboard, conversation history |
| **TF-IDF Semantic Memory** | Vector-space memory with cosine similarity, keyword overlap, recency decay, and importance scoring. Persisted with pre-computed embeddings |
| **Encrypted Vault** | AES-256-GCM encrypted secrets storage. Tools: `vault_set`, `vault_get`, `vault_delete`, `vault_list`, `vault_import` |
| **Token Cost Tracker** | Per-model rate tracking, session/daily budgets, JSONL audit log. Budget config with warning thresholds |
| **Work Products Tracker** | Records every file create/read/modify/delete with agent, hash, size, and task context |
| **Session Management** | Checkpoint create/restore/compact with full state capture (memory, vault, settings, teams). Auto-save every 10 tool calls |
| **Identity Layer (SOUL.md)** | Markdown file defining agent identity, loaded as first block in every system prompt |

### Multi-Agent Orchestration

| Feature | Description |
|---------|-------------|
| **Swarm DAG Engine** | YAML-defined directed acyclic graph execution with parallel waves, 3 modes (pipeline/parallel/sequential), cycle detection via Kahn's algorithm |
| **Pipeline Mode** | Repeat full DAG N times with CEO refinement direction between iterations |
| **Parallel Wave Execution** | All agents with satisfied dependencies run concurrently via `Promise.allSettled()` — failure isolation per agent |
| **Sub-Agent Delegation** | Delegate specialized tasks to background agents with dedicated tool belts |
| **Real-time Agent Chat** | WebSocket-based messaging between user and individual agents during swarm execution |
| **Pause/Resume** | Pause and resume swarm execution at agent or turn boundaries |

### Tools (32+ Available)

#### File Operations
- `list_dir`, `view_file` / `read`, `write`, `edit` — Standard file operations with path traversal protection
- `hashline_edit` — Compact line-anchored patch language with content-hash validation, boundary-balance repair, and 3-way merge recovery. Format: `¶path#TAG\nreplace N..N:\n+content`
- `glob` — Glob pattern matching
- `grep` — File content search via ripgrep with fallback

#### Search & Web
- `web_search` — Multi-provider web search (DuckDuckGo → HackerNews Algolia → Wikipedia API fallback chain)
- `web_fetch` — URL content extraction with HTML/JSON parsing, script/style stripping
- `ast_grep` — Language-aware structural code search with function/class/import extraction (JavaScript, TypeScript, Python, Rust, Go, Java, C/C++, Ruby, PHP, Swift, Kotlin)

#### Code Intelligence
- `lsp` — Language Server Protocol integration with 7 actions: `diagnostics`, `goto_def`, `references`, `hover`, `symbols`, `rename`, `code_actions`. Supports TypeScript, JavaScript, Python, Rust, Go
- `ast_grep` — Structural code analysis, function/class/import extraction per language

#### Browser & GitHub
- `browser` — Playwright-based headless browser: `navigate`, `click`, `type`, `screenshot` (base64 PNG), `extract` (selector or full page)
- `github` — GitHub API: `create_issue`, `list_issues`, `read_file`, `search_code`, `get_pr`, `list_prs`

#### Memory System
- `memory_store` — Store facts with type (fact/decision/preference/pattern/skill), importance, tags, and project scope
- `memory_search` — Semantic search with TF-IDF cosine similarity + keyword overlap + recency decay + importance scoring
- `memory_edit` — Edit or delete stored memories by ID

#### Social & Communication
- `post_to_reddit` — OAuth 2.0 password grant (requires REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD)
- `post_to_bluesky` — AT Protocol (requires BLUESKY_IDENTIFIER/APP_PASSWORD)
- `post_to_discord` — Webhook integration (requires DISCORD_WEBHOOK_URL)
- `post_to_telegram` — Bot integration (requires TELEGRAM_BOT_TOKEN/CHAT_ID)
- `send_email` — Gmail OAuth 2.0 device flow with auto token refresh
- `post_to_twitter` — Twitter API (legacy, payment required for new accounts)

#### Image & Media
- `generate_image` — Multi-provider image generation: OpenAI DALL-E 3, Gemini, Grok. Auto-selects from available API keys
- `text_to_speech` — Text-to-speech via edge-tts CLI with base64 audio output
- `render_mermaid` — Mermaid diagram rendering to SVG or ASCII fallback

#### SSH & Remote
- `ssh_exec` — Remote command execution via SSH with key-based or password auth

#### Plugin System
- `plugin` — Plugin management: `list`, `create`, `enable`, `disable`, `info`, `remove`. Sandboxed code execution via `vm` module

#### Planning & Goals
- `plan` — Multi-step plan management: `create`, `list`, `status`, `update_step`, `complete`, `abandon`, `resume`. Persisted to `plans.json`

#### Session Management
- `session` — Checkpoint management: `status`, `checkpoint`, `save`, `list`, `restore`, `compact`

#### MCP Integration
- MCP Client for external servers configured in `~/.pi/agent/mcp-servers.json`. Auto-discovers sequential-thinking server. Dynamic tool routing from `executeTool` to MCP server tools

#### Internal URL System
- `internal_url` — Protocol router with 8 protocol handlers:
  - `memory://` — Semantic memory search and listing
  - `vault://` — Encrypted credential lookup
  - `local://` — Workspace file access and directory listing
  - `omp://` — Embedded documentation topics
  - `issue://` — GitHub issue access via `gh` CLI
  - `pr://` — GitHub PR access with diff support
  - `skill://` — Skill file access (opencode skills)
  - `rule://` — Rule content access

#### Utilities
- `bash` — Shell command execution with 30s timeout
- `vault_set` / `vault_get` — Encrypted credential storage
- `ask_user` — Pause and wait for user input with timeout
- `delegate_to_subagent` — Task delegation to specialized sub-agents
- `search_obsidian` / `write_obsidian_note` — Obsidian vault interaction
- `todo_write` — Phased task list persistence

### DAG Swarm Configuration

Define complex multi-agent workflows with YAML at `~/.pi/agent/dag-config.yaml`:

```yaml
version: 1
mode: pipeline
pipeline_count: 3
agents:
  - id: researcher
    role: Research and gather information
    tools: [web_search, web_fetch, memory_search]
    task: Research the topic in detail
    waits_for: []
  - id: coder
    role: Implement solutions
    tools: [write, edit, bash, glob, grep]
    task: Implement the solution
    waits_for: [researcher]
  - id: tester
    role: Test and validate
    tools: [bash, glob, grep]
    task: Test everything works
    waits_for: [coder]
```

### MCP Server Integration

Configure external MCP servers in `~/.pi/agent/mcp-servers.json`:

```json
[
  {
    "name": "sequential-thinking",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    "enabled": true,
    "description": "Step-by-step reasoning"
  },
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    "enabled": true
  }
]
```

MCP tools are automatically discovered and integrated into the agent's toolset via `getActiveTools()`.

### LSP Integration

Language servers are started on-demand. Configure in `~/.pi/agent/lsp-servers.json`:

```json
{
  "typescript": { "command": "typescript-language-server", "args": ["--stdio"] },
  "python": { "command": "pyright-langserver", "args": ["--stdio"] },
  "rust": { "command": "rust-analyzer", "args": [] },
  "go": { "command": "gopls", "args": [] }
}
```

---

## Installation

```bash
npm install -g custom-pi
```

This auto-syncs all configurations — sub-agents, themes, system prompts, SOUL.md, and extension modules — to `~/.pi/agent/`.

### Prerequisites

- **Node.js** >= 18.0.0
- **Playwright** (for browser automation): `npx playwright install chromium`
- **Language servers** (for LSP): Install per-language servers (e.g., `npm install -g typescript-language-server`, `pip install pyright`)

---

## Usage

Start the agent in interactive mode from any workspace directory:

```bash
custom-pi
```

### Launch Web UI

```bash
# Build the web client (one-time)
npm run build:web

# Launch the web UI (served at http://localhost:4321)
custom-pi web
```

The web UI provides:
- Chat interface with streaming LLM responses, tool call visualization, and conversation history
- Swarm execution dashboard with agent status, logs, and CEO console
- Secrets Vault manager — add, reveal, delete encrypted secrets
- Budget panel — view token/cost stats, configure session/daily limits
- Memory browser — search, store, and browse persistent facts
- Work Products viewer — explore every file the agent created or modified
- Real-time updates via WebSocket

### Command Examples

```bash
# Interactive mode
custom-pi

# Non-interactive task
custom-pi -p "review the design document and create issues for problems found"

# Specific model
custom-pi --models "gemini/gemini-2.5-flash"
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/memory` | Displays active task state (goal, checklist, current subtask) |
| `/memory-stats` | Shows persistent memory statistics and recent entries |
| `/memory-reset` | Clears the current session's task state |
| `/consolidate` | Manually triggers memory consolidation |
| `/list_subagents` | Lists all active sub-agents and their tool configurations |
| `/help` | Shows available commands and keyboard shortcuts |

---

## Architecture

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────┐
│         custom-pi Web Server (Fastify)        │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Tool Exec  │  │ Swarm    │  │ WebSocket  │  │
│  │ (32 tools) │  │ DAG Eng. │  │ Broadcaster│  │
│  └─────┬─────┘  └────┬─────┘  └───────────┘  │
│        │              │                       │
│  ┌─────┴──────────────┴──────┐                │
│  │      MCP Client Pool      │                │
│  │  (sequential-thinking,    │                │
│  │   filesystem, etc.)       │                │
│  └───────────────────────────┘                │
│  ┌───────────────────────────┐                │
│  │   LSP Client Pool         │                │
│  │  (TypeScript, Python,     │                │
│  │   Rust, Go, etc.)         │                │
│  └───────────────────────────┘                │
└──────────────────┬────────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Vault   │ │ Memory   │ │ Session  │
│ AES-256  │ │ TF-IDF   │ │ Checkpts │
│ GCM      │ │ Vectors  │ │ JSON     │
└──────────┘ └──────────┘ └──────────┘

Web Client (React + Vite + TypeScript)
┌──────────────────────────────────────────┐
│ SubAgentPanel │ CEO Console │ Agent Chat  │
│ ToolCallCard  │ QuestionModal │ Dashboard │
└──────────────────────────────────────────┘
```

### Internal URL Resolution Flow

```
internal_url("memory://query")
    → parsed: protocol="memory:", hostname="query"
    → switch(protocol):
        case "memory:" → memorySearch(query)
        case "vault:" → vaultGet(key)
        case "local:" → readWorkspaceFile(path)
        case "omp:" → embeddedDoc(topic)
        case "issue:" → gh issue view NUMBER
        case "pr:" → gh pr view NUMBER
        case "skill:" → readSkillFile(name)
        case "rule:" → readRuleFile(name)
```

### Tool Execution Flow

```
executeTool(name, args, cwd)
    ├── Check MCP servers → if tool found, delegate to MCP
    ├── switch(name):
    │   ├── "list_dir" | "view_file" | "read" | "write" | "edit"
    │   ├── "bash" | "glob" | "grep"
    │   ├── "memory_store" | "memory_search" | "memory_edit"
    │   ├── "vault_set" | "vault_get"
    │   ├── "web_search" | "web_fetch"
    │   ├── "browser" | "github"
    │   ├── "lsp" | "ast_grep"
    │   ├── "generate_image" | "text_to_speech"
    │   ├── "ssh_exec" | "plugin" | "plan" | "session"
    │   ├── "post_to_*" | "send_email"
    │   ├── "hashline_edit" | "internal_url"
    │   └── "ask_user" | "delegate_to_subagent"
    └── Auto-save session state every 10 calls
```

---

## File Layout

```
~/.pi/agent/
├── SOUL.md                          # Identity layer
├── SYSTEM.md                        # System instructions
├── settings.json                    # User settings (default model, etc.)
├── models.json                      # Model provider configurations
├── semantic.json                    # TF-IDF memory entries
├── semantic.vec.json               # Pre-computed embedding vectors
├── session-state.json               # Auto-saved session state
├── plans.json                       # Planning/goals mode state
├── swarm-state.json                 # DAG swarm execution persistence
├── swarm-teams.json                 # Saved swarm team configurations
├── dag-config.yaml                  # DAG swarm workflow definition
├── mcp-servers.json                 # MCP server configurations
├── lsp-servers.json                 # LSP server configurations
├── todos.json                       # Task list persistence
├── memory/
│   └── semantic.json                # Memory entries
├── checkpoints/                     # Session checkpoints
├── costs/
│   ├── session-costs.jsonl          # Token/cost tracking log
│   └── budget-config.json           # Budget limits
├── work-products/
│   └── products.jsonl               # File change tracking log
├── plugins/                         # Installed plugins
├── mermaid/                         # Rendered mermaid diagrams
├── tts/                             # Generated TTS audio files
├── .vault/                          # Encrypted secrets vault
├── web/
│   ├── web-server.mjs              # Web UI server
│   └── client/dist/                # Built React frontend
└── skills/
    ├── agent/                       # Agent-authored skills
    └── .skill-usage.json            # Usage telemetry
```

---

## Configuration Sync

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

## Testing

142 unit tests covering every subsystem:

```
 ✓ soul-loader                  ✓ secret-vault
 ✓ memory-file-store            ✓ cost-tracker
 ✓ memory-nudge                 ✓ work-products
 ✓ state-db                     ✓ cron-scheduler
 ✓ skill-store                  ✓ web-search
 ✓ skill-retrieval              ✓ memory-embedding
 ✓ memory-embedding-upgrade     ✓ hashline
 ✓ tui-colors                   ✓ mcp-client
 ✓ lsp-integration              ✓ session-management
```

```bash
npm test          # Run all tests
npx tsc --noEmit  # TypeScript type check
```

---

## License

Licensed under the [MIT License](LICENSE).
