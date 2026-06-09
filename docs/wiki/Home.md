# 🧬 Custom-PI Wiki

Welcome to the **Custom-PI** wiki! Custom-PI is a next-generation engineering extension suite for the Pi Coding Agent that combines the speed and articulation of **Hermes** with the relentless goal-seeking optimization of the **Paperclip Maximizer**.

With a suite of 32+ custom tools, a parallel DAG swarm orchestrator, semantic memory vectors, and dual terminal/web user interfaces, Custom-PI is built to handle complex software tasks autonomously without forgetting context, hitting single-agent bottlenecks, or compromising credentials.

## 📖 Navigation

Use the pages below to explore the architecture, configuration, and tools of Custom-PI:

1. **[Architecture](Architecture)**
   Understand the project structure, how the extensions wrap the host agent, synchronization strategies, and local files organization under `~/.pi/agent/`.
2. **[DAG Swarm Orchestration](DAG-Swarm-Orchestration)**
   Explore how Custom-PI deploys multiple agents (Researcher, Coder, Reviewer) in pipeline, parallel, or sequential modes to solve problems concurrently.
3. **[Tool Arsenal & Plugins](Tool-Arsenal---Plugins)**
   An exhaustive reference list of the 32+ custom tools (Browser, SSH, LSP, ast-grep, Reddit/Twitter/Bluesky, Vault) and how to extend Custom-PI via custom plugins.
4. **[Semantic Memory & Vault](Semantic-Memory---Vault)**
   Deep-dive into our TF-IDF memory system, cosine-similarity based recency-decay retrieval, Obsidian RAG sync, and the AES-256-GCM encrypted secrets vault.
5. **[TUI & Web Dashboard](TUI---Web-Dashboard)**
   Details on using the fullscreen terminal UI with double-buffered rendering and vim keybindings, or the React/Vite-based web interface featuring real-time WebSockets and a Three.js swarm visualization.

---

*Custom-PI is developed by [Nishant Unavane](https://nishant-unavane.vercel.app) under the MIT License.*