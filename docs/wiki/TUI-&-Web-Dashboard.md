# 🖥️ TUI & Web Dashboard

Custom-PI features dual premium user interfaces built for engineers who want both visual dashboards and console-based productivity.

## 📟 Fullscreen Terminal UI (TUI)

The fullscreen TUI is built using custom ANSI writing engines, bringing dashboard analytics straight to the terminal:

* **Double-Buffered Renderer**: Writes updates to an in-memory screen grid, computes the diff, and writes only changed characters to stdout. This completely eliminates screen flickering.
* **Vim Input Keybindings**: Full keyboard integration support:
  * `Esc`: Cancel running sub-agents or close active popup overlays.
  * `Tab`: Rotate focus through layout panels (Telemetry HUD, Swarm Logs, Chat).
  * `j` / `k`: Scroll through command logs and outputs.
* **Quantum HUD Widget**: Displays system diagnostics (CPU load, free memory), active vaults state, and real-time execution speeds.

---

## 🌐 Vite/React Web Dashboard

For complex workflows and rich telemetry, launch the React-based Web Dashboard:

```bash
custom-pi-web
```

The web UI hosts several widgets:
1. **Interactive Swarm Topology**: A real-time Three.js graph visualization showing nodes as agents (Researcher, Coder, Reviewer). Links flash and pulse as information flows between them.
2. **Secrets Vault Manager**: Add, update, and manage credential mappings via a secure web portal.
3. **Telemetry & Budgets**: Graphic indicators illustrating token consumption, daily cost limits, and remaining API quotas.
4. **Live Logs Stream**: Real-time WebSocket streaming that pushes LLM reasoning tokens and tool invocation parameters directly to the web client.