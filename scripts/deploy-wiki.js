const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COLORS = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${COLORS[color] || ''}${message}${COLORS.reset}`);
}

// 1. Load env variables
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = cleanedValue = value;
      }
    }
  });
}

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  log('red', '❌ Error: GITHUB_TOKEN or GH_TOKEN is not set in the environment or .env file.');
  log('yellow', 'Please provide a GitHub Personal Access Token to authenticate wiki operations.');
  process.exit(1);
}

const WIKI_DIR = path.join(process.cwd(), 'wiki-temp');

// Cleaning previous run
if (fs.existsSync(WIKI_DIR)) {
  log('yellow', '🧹 Cleaning up existing wiki-temp directory...');
  fs.rmSync(WIKI_DIR, { recursive: true, force: true });
}

// 2. Clone the Wiki Repository
const wikiRepoUrl = `https://x-token-auth:${token}@github.com/IamNishant51/Custom-PI.wiki.git`;
log('cyan', '📦 Cloning the GitHub Wiki repository...');
try {
  execSync(`git clone ${wikiRepoUrl} "${WIKI_DIR}"`, { stdio: 'pipe' });
  log('green', '✅ Wiki repository cloned successfully.');
} catch (e) {
  log('red', '❌ Error: Failed to clone Wiki repository.');
  log('yellow', 'Please make sure you have visited the Wiki page on GitHub web UI:');
  log('yellow', '👉 https://github.com/IamNishant51/Custom-PI/wiki');
  log('yellow', 'and clicked "Create the first page" (usually named Home) and saved it to initialize the wiki repository.');
  process.exit(1);
}

// Define the wiki pages
const wikiPages = {
  'Home.md': `# 🧬 Custom-PI Wiki

Welcome to the **Custom-PI** wiki! Custom-PI is a next-generation engineering extension suite for the Pi Coding Agent that combines the speed and articulation of **Hermes** with the relentless goal-seeking optimization of the **Paperclip Maximizer**.

With a suite of 32+ custom tools, a parallel DAG swarm orchestrator, semantic memory vectors, and dual terminal/web user interfaces, Custom-PI is built to handle complex software tasks autonomously without forgetting context, hitting single-agent bottlenecks, or compromising credentials.

## 📖 Navigation

Use the pages below to explore the architecture, configuration, and tools of Custom-PI:

1. **[Architecture](Architecture)**
   Understand the project structure, how the extensions wrap the host agent, synchronization strategies, and local files organization under \`~/.pi/agent/\`.
2. **[DAG Swarm Orchestration](DAG-Swarm-Orchestration)**
   Explore how Custom-PI deploys multiple agents (Researcher, Coder, Reviewer) in pipeline, parallel, or sequential modes to solve problems concurrently.
3. **[Tool Arsenal & Plugins](Tool-Arsenal-&-Plugins)**
   An exhaustive reference list of the 32+ custom tools (Browser, SSH, LSP, ast-grep, Reddit/Twitter/Bluesky, Vault) and how to extend Custom-PI via custom plugins.
4. **[Semantic Memory & Vault](Semantic-Memory-&-Vault)**
   Deep-dive into our TF-IDF memory system, cosine-similarity based recency-decay retrieval, Obsidian RAG sync, and the AES-256-GCM encrypted secrets vault.
5. **[TUI & Web Dashboard](TUI-&-Web-Dashboard)**
   Details on using the fullscreen terminal UI with double-buffered rendering and vim keybindings, or the React/Vite-based web interface featuring real-time WebSockets and a Three.js swarm visualization.

---

*Custom-PI is developed by [Nishant Unavane](https://nishant-unavane.vercel.app) under the MIT License.*`,

  'Architecture.md': `# 🧬 Architecture

Custom-PI acts as a premium extension wrapper around \`@earendil-works/pi-coding-agent\`. Upon initialization, it bridges local assets into the agent's workspace configuration to enrich its system prompts, extend its tools arsenal, and mount UI dashboards.

## 📂 File Layout and Sync System

When you execute \`custom-pi\` or \`custom-pi-web\`, the system synchronizes configurations, agents, themes, and extensions from the package distribution into the active runtime directory at \`~/.pi/agent/\`:

\`\`\`
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
\`\`\`

## 🔄 Execution Pipeline

The runtime flow consists of the following phases:

1. **Bootstrap & Sync**: The CLI runner verify assets in \`~/.pi/agent/\`. If any file is missing or outdated, it overrides it with assets from the installation package.
2. **Identity Synthesis**: [soul-loader.ts](file:///home/nishant/Desktop/pi-custom-pack/assets/extensions/subagents/src/soul-loader.ts) loads the identity guidelines in \`SOUL.md\`.
3. **Agent Registration**: The custom extension registers 32+ custom tools, custom subagents, and hooks into the host agent's cycle.
4. **Environment Monitoring**: The system initializes LSP clients for code telemetry and registers background active listeners.
5. **Dashboard Initialization**: The CLI starts either the fullscreen TUI or spawns the Fastify web server serving WebSocket events.`,

  'DAG-Swarm-Orchestration.md': `# ⛓️ DAG Swarm Orchestration

Single agents often run into logical dead-ends or loop indefinitely on complex debugging cycles. Custom-PI solves this by introducing a **Directed Acyclic Graph (DAG) Multi-Agent Swarm**. The swarm routes sub-tasks to specialized agents running concurrently.

## 👥 Swarm Roles

By default, the swarm is composed of three roles:
1. **Researcher**: Specialized in exploring directories, performing web searches, querying semantic memory, and analyzing specifications. Equipped with search and reading tools.
2. **Coder**: Focuses on implementing the actual solution, editing files, running compiler/linter tasks, and recovering from errors. Equipped with file writing, diff, and refactoring tools.
3. **Reviewer**: Evaluates the coder's deliverables, runs the test suite, validates type safety, and analyzes performance metrics. Equipped with shell execution, LSP, and ast-grep tools.

## 🔄 Execution Modes

Swarms are configured in \`~/.pi/agent/dag-config.yaml\` and support three modes:

### 1. Pipeline Mode
Executes agents sequentially according to their dependency tree. Once the end of the pipeline is reached, the **CEO Orchestrator** checks the deliverables. If there are failures, it generates feedback and routes it back to the Researcher/Coder for another iteration.
\`\`\`mermaid
graph TD
  A[Researcher] --> B[Coder]
  B --> C[Reviewer]
  C -->|Feedback Check| D{Passed?}
  D -->|No| A
  D -->|Yes| E[Deliver Goal]
\`\`\`

### 2. Parallel Mode
Agents run concurrently. This is useful for wide-scale codebase audits, parallel research, and running multiple testing tasks at the same time.

### 3. Sequential Mode
Forces a strict, single-lane execution pipeline where each agent runs only after its parent successfully terminates.

## 🛡️ Cycle Detection & Isolation
* **Cycle Prevention**: Built-in topological sorting using **Kahn's Algorithm** runs prior to execution to detect circular dependencies in \`dag-config.yaml\`.
* **Failure Isolation**: If a sub-agent fails a turn, its execution is paused, and the error is fed to the CEO Orchestrator. The remainder of the swarm is isolated from cascading crashes.`,

  'Tool-Arsenal-&-Plugins.md': `# 🛠️ Tool Arsenal & Plugins

Custom-PI features an advanced arsenal of 32+ custom tools that enable wide-ranging integrations, web browsing, diagnostic analysis, and automated tasks.

## 🔍 Tool Reference Sheet

| Group | Tool | Description |
|---|---|---|
| **Search & Web** | \`web_search\` | Dynamic search with fallbacks (DuckDuckGo ➔ Algolia HN ➔ Wikipedia). |
| | \`web_fetch\` | Fetches web page content, parses HTML/JSON, automatically sets User-Agents. |
| | \`internal_url\` | Resolves internal protocol URIs like \`memory://\`, \`vault://\`, and \`issue://\`. |
| **Automation** | \`browser\` | Starts headless Chromium using Playwright to navigate, click, type, screenshot, and extract data. |
| | \`ssh_exec\` | Secure SSH client supporting password and key-based remote command execution. |
| **Code Intelligence**| \`lsp\` | Connects to TS/JS, Python, Rust, and Go language servers for hover definitions, renames, and diagnostics. |
| | \`ast_grep\` | Uses structural AST queries to find classes, functions, and imports in 11 languages. |
| | \`hashline_edit\` | Generates content-hash validated patches to prevent corrupted edits. |
| **Communications**| \`github\` | Integrates with GitHub API to manage issues, pull requests, and search files. |
| | \`send_email\` | Uses Gmail API OAuth 2.0 Device Flow to compose and send emails. |
| **Social** | \`post_to_reddit\` | Submits posts using Reddit OAuth password grant. |
| | \`post_to_bluesky\` | Connects to AT Protocol to post text feeds. |
| | \`post_to_discord\` | Broadcasts messages via Discord webhooks. |
| | \`post_to_telegram\`| Sends text and status updates using Telegram Bot API. |
| **Encryption/RAG**| \`memory_store\` | Indexes semantic memory vectors with recency decay factors. |
| | \`vault_set\` | Inserts or updates credentials in the encrypted AES-256 vault. |
| **Media** | \`generate_image\` | Generates images using DALL-E 3, Gemini, or Grok depending on keys. |
| | \`text_to_speech\` | Generates voice audio base64 buffers using Edge-TTS. |
| | \`render_mermaid\`| Renders diagrams into SVG formats with ASCII fallbacks. |

---

## 🔌 Custom Plugin System

You can extend Custom-PI by writing custom Javascript/TypeScript plugins. Custom-PI reads files inside \`~/.pi/agent/plugins/\`.

### Defining a Plugin
Create a \`plugin.js\` inside the plugins directory:

\`\`\`javascript
module.exports = {
  name: "my_custom_tool",
  description: "A custom tool that performs calculations",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression to evaluate" }
    },
    required: ["expression"]
  },
  async execute({ expression }) {
    // Perform task
    const result = eval(expression); // Caution: run securely!
    return { status: "success", result };
  }
};
\`\`\`

Plugins are dynamically loaded and registered on startup. All execution is sandboxed, and destructive commands are subject to user approval gates.`,

  'Semantic-Memory-&-Vault.md': `# 🧠 Semantic Memory & Vault

Context windows can only hold so much. Custom-PI implements semantic search and military-grade encryption to manage long-term memories and API secrets.

## 🧠 Semantic Memory (TF-IDF Vector Space)

Instead of relying on simple keyword matches, Custom-PI computes TF-IDF semantic vectors of all notes and sessions:

1. **Vector Modeling**: Important takeaways, code signatures, and decisions are modeled into vectors.
2. **Cosine Similarity**: During queries, Custom-PI computes the cosine similarity between the query term vector and the memory vector pool.
3. **Recency Decay**: To ensure newer decisions take precedence over old ones, similarity scores are multiplied by a time-decay factor:
   $$\\text{Score} = \\text{Similarity} \\times e^{-\\lambda t}$$
4. **Memory Nudges**: When a task relates to a previous session, a semantic memory snippet is pushed as a system nudge to keep the model updated.

### 📓 Obsidian RAG Sync
Custom-PI connects directly to your local Obsidian vault. It indexes files inside the vault, syncing them into the vector space. It updates \`Agent_Memory.md\` dynamically, establishing a bi-directional knowledge loop.

---

## 🔐 Encrypted Secrets Vault

Plaintext API tokens in environment variables or configuration files are security hazards. Custom-PI stores credentials in an encrypted SQLite or JSON payload.

### Cryptographic Standards
* **Cipher**: \`aes-256-gcm\` (Authenticated Encryption with Associated Data).
* **PBKDF2**: Derives secure local encryption keys.
* **Initialization Vector (IV)**: 12-byte cryptographically secure random bytes generated per write operation.
* **Auth Tag**: 16-byte authentication tag generated by GCM mode to prevent ciphertext tampering.

### Authentication Flow
On startup, the vault checks for the master key:
1. It looks for \`CUSTOM_PI_VAULT_KEY\` or \`PI_VAULT_KEY\` in your environment.
2. If not found, it attempts to read the master key file located at \`~/.pi/agent/.vault/master.key\` (permission scoped at \`0600\`).
3. If both are missing, it initializes a brand new master key.`,

  'TUI-&-Web-Dashboard.md': `# 🖥️ TUI & Web Dashboard

Custom-PI features dual premium user interfaces built for engineers who want both visual dashboards and console-based productivity.

## 📟 Fullscreen Terminal UI (TUI)

The fullscreen TUI is built using custom ANSI writing engines, bringing dashboard analytics straight to the terminal:

* **Double-Buffered Renderer**: Writes updates to an in-memory screen grid, computes the diff, and writes only changed characters to stdout. This completely eliminates screen flickering.
* **Vim Input Keybindings**: Full keyboard integration support:
  * \`Esc\`: Cancel running sub-agents or close active popup overlays.
  * \`Tab\`: Rotate focus through layout panels (Telemetry HUD, Swarm Logs, Chat).
  * \`j\` / \`k\`: Scroll through command logs and outputs.
* **Quantum HUD Widget**: Displays system diagnostics (CPU load, free memory), active vaults state, and real-time execution speeds.

---

## 🌐 Vite/React Web Dashboard

For complex workflows and rich telemetry, launch the React-based Web Dashboard:

\`\`\`bash
custom-pi-web
\`\`\`

The web UI hosts several widgets:
1. **Interactive Swarm Topology**: A real-time Three.js graph visualization showing nodes as agents (Researcher, Coder, Reviewer). Links flash and pulse as information flows between them.
2. **Secrets Vault Manager**: Add, update, and manage credential mappings via a secure web portal.
3. **Telemetry & Budgets**: Graphic indicators illustrating token consumption, daily cost limits, and remaining API quotas.
4. **Live Logs Stream**: Real-time WebSocket streaming that pushes LLM reasoning tokens and tool invocation parameters directly to the web client.`
};

// 3. Write wiki pages
log('cyan', '✍️ Generating Wiki pages...');
Object.keys(wikiPages).forEach(filename => {
  const filePath = path.join(WIKI_DIR, filename);
  fs.writeFileSync(filePath, wikiPages[filename], 'utf8');
  log('cyan', `- Created: ${filename}`);
});

// 4. Commit and Push
log('cyan', '📤 Committing and pushing Wiki pages...');
try {
  const gitOpts = { cwd: WIKI_DIR, stdio: 'inherit' };
  execSync('git add .', gitOpts);
  
  // Set temporary identity if git not configured globally
  try {
    execSync('git config user.name "Custom-PI Release Bootstrapper"', gitOpts);
    execSync('git config user.email "iamnishantunavane@gmail.com"', gitOpts);
  } catch (e) {
    // Ignore if fails
  }

  execSync('git commit -m "docs: deploy comprehensive project wiki documentation"', gitOpts);
  
  // Get active branch name dynamically
  const activeBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: WIKI_DIR, encoding: 'utf8' }).trim();
  log('cyan', `- Pushing wiki pages to branch: ${activeBranch}...`);
  execSync(`git push origin ${activeBranch}`, gitOpts);
  
  log('green', '\n🎉 Success! Custom-PI GitHub Wiki has been successfully updated and published.');
  log('green', '🔗 Wiki Home URL: https://github.com/IamNishant51/Custom-PI/wiki');
} catch (e) {
  log('red', '❌ Error: Failed to commit or push wiki pages.');
  console.error(e.message);
  process.exit(1);
} finally {
  // Clean up
  if (fs.existsSync(WIKI_DIR)) {
    log('yellow', '🧹 Cleaning up wiki-temp directory...');
    fs.rmSync(WIKI_DIR, { recursive: true, force: true });
  }
}
