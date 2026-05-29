# custom-pi

<p align="center">
  <img src="https://raw.githubusercontent.com/IamNishant51/Custom-PI/main/pi-logo-on-dark.svg" alt="custom-pi Logo" width="160" />
</p>

<p align="center">
  A highly-optimized and aesthetically premium wrapper for the core Pi Coding Agent.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/custom-pi"><img src="https://img.shields.io/npm/v/custom-pi.svg?style=flat-flat&color=A9B665" alt="NPM Version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-7DAEA3.svg?style=flat-flat" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-C9A0DC.svg?style=flat-flat" alt="Node Version" /></a>
</p>

---

custom-pi is an enhanced, highly-optimized, and aesthetically premium wrapper for the core Pi Coding Agent (@earendil-works/pi-coding-agent).

It supercharges the autonomous software engineering experience by integrating a parallel sub-agent swarm, advanced prompt-injection protection, real-time TUI progress dashboards, and a session-specific task state memory engine.

---

## Key Enhancements

### 1. Parallel Sub-Agent Swarm (Multi-Agent Swarm)
Delegate complex multi-file, research, and testing tasks to a team of specialized background sub-agents:
* **builder**: Full-stack Next.js developer expert equipped to write error-free backend APIs and responsive frontends.
* **researcher**: Tracing expert that explores directory trees, reads files, and analyzes logic flows across codebases.
* **reviewer**: A critical design and code auditor focusing on security (OWASP), performance bottlenecks, WCAG accessibility, and architectural consistency.
* **Dynamic Spawn:** Autonomously create specialized sub-agents on the fly using /create_subagent.

### 2. Input Sanitization & Hijack Protection (Anti-Pollution)
Prevents prompt-injection and instruction-hijacking. When the agent reads design specifications or guidelines (e.g. Pi_DESIGN.md) containing imperative statements ("Do X", "Do not do Y"), the prompt protection engine isolates the contents as passive data. The agent is strictly locked to your conversation goals and never gets distracted.

### 3. Session Task State Memory (RAG-Optimized)
Keeps the agent focused on long-running multi-step tasks. Appends a structured, temporary task state (goals, completed items, active task, pending items) directly into the agent prompt context. Use /memory to view current state and /memory-reset to clear it.

### 4. OOM-Free Animated TUI Dashboards
Includes a beautiful, rounded box-border TUI panel system styled after modern CLI designs. Features Braille animation spinners, dot pulses, and cycling reasoning verbs. The engine utilizes key-based Map invalidations, guaranteeing a zero-leak, OOM-free rendering loop during parallel execution.

---

## Installation

To install custom-pi and synchronize all custom extensions and templates automatically:

```bash
npm install -g custom-pi
```

---

## Usage

Launch the customized agent in interactive mode from any project directory:

```bash
custom-pi
```

You can pass standard Pi options and initial prompts directly:

```bash
# Non-interactive file review
custom-pi -p "use reviewer subagent to review the file on my Desktop named Pi_DESIGN.md"

# Run with a specific model cycling setting
custom-pi --models "gemini/gemini-2.5-flash,gemini/gemini-2.5-pro"
```

---

## Commands

Execute these special slash commands inside the active session chat:

* /memory - Renders the current session's active, completed, and pending subtask list directly inside the terminal console.
* /memory-reset - Clears the active session's task state memory file.
* /list-subagents - Lists all currently loaded specialized sub-agents and their allowed tool configurations.

---

## Synchronizing & Backing Up Configurations

To update the NPM package whenever you modify your settings, custom prompt (SYSTEM.md), subagents, or extensions locally:

1. Open a terminal inside the package directory:
   ```bash
   cd ~/Desktop/pi-custom-pack
   ```
2. Run the update script. It will copy your active local ~/.pi/agent/ configuration, bump the patch version, and publish it to the npm registry:
   ```bash
   npm run update-and-publish
   ```
3. To update your devices to the latest sync, run:
   ```bash
   npm update -g custom-pi
   ```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
