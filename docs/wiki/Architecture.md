# 🧬 Architecture

Custom-PI acts as a premium extension wrapper around `@earendil-works/pi-coding-agent`. Upon initialization, it bridges local assets into the agent's workspace configuration to enrich its system prompts, extend its tools arsenal, and mount UI dashboards.

## 📂 File Layout and Sync System

When you execute `custom-pi` or `custom-pi-web`, the system synchronizes configurations, agents, themes, and extensions from the package distribution into the active runtime directory at `~/.pi/agent/`:

```
~/.pi/agent/
├── SOUL.md                 # Identity layer (pre-loaded prompt block)
├── SYSTEM.md               # Base engineering guidelines
├── settings.json           # Default models, budgets, and tokens
├── models.json             # API keys and provider endpoints
├── semantic.json           # SQLite FTS5 index and key memories
├── semantic.vec.json       # Pre-computed TF-IDF semantic vectors
├── session-state.json      # Auto-saved checkpoints (every 10 tool calls)
├── dag-config.yaml         # Swarm workflow structure (pipeline/parallel)
├── mcp-servers.json        # Configured Model Context Protocol servers
├── lsp-servers.json        # Configured Language Server Protocols
├── checkpoints/            # Directory containing past session states
├── costs/                  # Cost, budget, and token tracking logs
├── work-products/          # Deliverables and file modifications ledger
├── plugins/                # Directory containing custom javascript plugins
├── .vault/                 # Secure AES-256 encrypted vault dir
│   ├── master.key          # Hex-encoded key file
│   └── vault.json          # GCM ciphertext storage
└── web/                    # Built React web client + Fastify WS server
```

## 🔄 Execution Pipeline

The runtime flow consists of the following phases:

1. **Bootstrap & Sync**: The CLI runner verify assets in `~/.pi/agent/`. If any file is missing or outdated, it overrides it with assets from the installation package.
2. **Identity Synthesis**: [soul-loader.ts](file:///home/nishant/Desktop/pi-custom-pack/assets/extensions/subagents/src/soul-loader.ts) loads the identity guidelines in `SOUL.md`.
3. **Agent Registration**: The custom extension registers 32+ custom tools, custom subagents, and hooks into the host agent's cycle.
4. **Environment Monitoring**: The system initializes LSP clients for code telemetry and registers background active listeners.
5. **Dashboard Initialization**: The CLI starts either the fullscreen TUI or spawns the Fastify web server serving WebSocket events.