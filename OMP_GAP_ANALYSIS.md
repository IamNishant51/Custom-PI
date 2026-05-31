# Oh-My-Pi vs pi-custom-pack: Complete Feature Gap Analysis

Based on deep reverse-engineering of the entire oh-my-pi codebase (56+ tools, 15 Rust crates, 6 TypeScript packages, memory system, swarm DAG, hashline editor, internal URLs, and more).

---

## 1. Current State of pi-custom-pack

### Existing Tools (15 total)
| Tool | Category |
|------|----------|
| list_dir | File ops |
| view_file / read | File ops |
| write | File ops |
| edit | File ops |
| bash | Execution |
| glob | File ops |
| grep | File ops |
| memory_store | Memory |
| memory_search | Memory |
| vault_set / vault_get | Config |
| ask_user | Interaction |
| delegate_to_subagent | Task delegation |
| search_obsidian | External |
| write_obsidian_note | External |
| post_to_twitter | Social |

### Missing Entire Feature Categories (vs oh-my-pi's 56+ tools in 15 categories)
- **Advanced file editing**: hashline format (line-anchored content-hash diff), AST-aware edit, AST-aware search
- **Web search**: 14 search providers (Anthropic, Perplexity, Exa, Brave, Kagi, Tavily, Gemini, etc.)
- **Browser automation**: headless browser with navigation, click, type, screenshot
- **GitHub integration**: issues, PRs, search, commits, diffs
- **LSP integration**: diagnostics, goto-def, references, hover, symbols, rename
- **Rich memory system**: mnemopi — embeddings, beam search, polyphonic recall, entity extraction, triples, consolidation
- **Code intelligence**: tree-sitter AST queries, structural search/replace, syntax highlighting, token counting
- **Image handling**: generation (7 providers), inspection (EXIF/dimensions), SIXEL terminal display
- **Audio**: TTS (xAI Grok Voice), image-to-SIXEL encoding
- **MCP server integration**: dynamic tool discovery, resource URIs
- **Internal URL system**: 11 protocol handlers (memory://, vault://, issue://, pr://, skill://, rule://, mcp://, etc.)
- **Session management**: checkpoints, rewind, compaction, state persistence
- **Approval workflow**: multi-tier approval before external actions
- **Obisidian vault queries**: structural queries (outline, backlinks, tags, tasks, search, daily, orphans)
- **Exa API integration**: 18 tools (search, researcher, websets with enrichments/monitoring)
- **SSH remote execution**: command execution on remote hosts
- **Multi-agent coordination**: IRC inter-agent channel, parallel subagent execution
- **Rendering**: Mermaid diagram generation
- **Code review**: structured finding reporting with priority/confidence scoring
- **Task/job management**: async long-running jobs, goal-oriented mode management
- **Plugin/marketplace system**: skill hot-reload, discovery, version management
- **SEO / semantic tools**: BM25 search tool discovery, semantic compression
- **QA tools**: automated tool issue reporting with SQLite recording

---

## 2. oh-my-pi Architecture We Should Port

### 2.1 Rust Native Addon (pi-natives)
oh-my-pi has 30+ native functions compiled via napi-rs into a `.node` addon:
- **grep**: ripgrep-backed with glob/type filtering, context lines, streaming, caching
- **glob**: `.gitignore`-aware with mtime sorting, streaming callback
- **fuzzyFind**: subsequence-scored fuzzy file path autocomplete
- **clipboard**: system clipboard copy/paste (text + images)
- **PtySession**: interactive PTY sessions via portable-pty
- **Shell**: brush-based POSIX shell with output minimizer (100+ CLI tools)
- **Process**: cross-platform process tree management (kill tree, enumerate)
- **text**: ANSI-aware visible width, truncation, word wrap
- **highlight**: syntect-based syntax highlighting (11 semantic categories)
- **htmlToMarkdown**: HTML→Markdown for AI context
- **encodeSixel**: image→SIXEL terminal encoding
- **summarizeCode**: tree-sitter structural code summarization
- **astGrep/astEdit**: AST-aware code search and rewrite
- **countTokens**: embedded BPE tables (o200k_base, cl100k_base)
- **listWorkspace**: bounded entry tree + AGENTS.md discovery
- **isoBackend**: filesystem isolation (APFS clones, overlayfs, ZFS snapshots)
- **blockRangeAt**: tree-sitter syntactic block resolution

**Status**: None of this exists in pi-custom-pack. We rely on simple Node.js `fs` and `child_process`.

### 2.2 Hashline Editor (packages/hashline)
A compact, line-anchored, content-hash-bound patch language for LLM-driven file editing:
- **Content-derived 4-hex hash tag** per file section — validates file hasn't drifted
- **6 operation types**: replace, delete, insert before/after/head/tail, replace block, delete block
- **Boundary-balance repair**: auto-fixes common LLM mistakes (duplicate/missing delimiters)
- **3-way merge recovery**: stale tags → merge against snapshot
- **Session-chain replay**: prior in-session edits → replay onto current content
- **Streaming tokenizer/parser**: incremental parsing for live diff previews
- **All-or-nothing multi-section**: prepare all sections before committing any
- **Pluggable Filesystem abstraction**: works with any backend (S3, HTTP, git trees)
- **SnapshotStore**: versioned file state with configurable depth (default: 30 paths, 4 versions/path)
- **BOM/line-ending round-trip**: preserves original encoding

**Status**: pi-custom-pack uses simple `edit` (search/replace). No hash validation, no recovery, no streaming.

### 2.3 Memory System (packages/mnemopi)
A sophisticated long-term memory system with 50+ source files:
- **Embeddings**: configurable providers (OpenAI, Anthropic, Ollama, local), optional
- **Beam search**: tiered retrieval (top-K, MMR re-rank, score threshold)
- **Polyphonic recall**: multi-aspect query expansion with synonym support
- **Entity extraction**: NL-based entity/relation/triple extraction from conversations
- **Triplestore**: (subject, predicate, object) with temporal decay and consolidation
- **Veracity consolidation**: confidence scoring, contradiction detection, fact merging
- **Content sanitizer**: PII stripping, irrelevant content filtering
- **Typed memory**: annotated with types, tags, importance scores
- **Memory banks**: typed directories (facts, procedures, preferences, etc.)
- **Episodic graph**: temporal episode linking with recency decay
- **Pattern detection**: recurring themes across memories (SHMR — surprise, habituation, memory, recall)
- **Disaster recovery**: SQLite integrity checks, cold-start reconstruction
- **MCP server**: exposes memory as MCP tools (recall, retain, reflect, memory_edit)
- **Temporal parsing**: relative date/time extraction ("two days ago", "last week")
- **AAaK (Agent as a Knowledgebase)**: on-the-fly query-specific knowledge extraction
- **Migration system**: schema evolution (e.g., e6 triplestore split)
- **Diagnostics**: DB integrity, env validation, extraction success rates

**Status**: pi-custom-pack has simple `memory_store`/`memory_search` (key-value). No embeddings, no beam search, no entity extraction, no consolidation.

### 2.4 Swarm DAG Engine (packages/swarm-extension)
Advanced multi-agent orchestration:
- **Full DAG topology**: any directed graph of dependencies
- **Parallel wave execution**: all agents with satisfied deps run concurrently
- **Cycle detection**: Kahn's algorithm, rejected before execution
- **3 execution modes**: pipeline (iterative), parallel (all-at-once), sequential (chain)
- **Iterative pipelines**: `target_count` repeats the full DAG N times
- **Dual dependency semantics**: `waits_for` (explicit) AND `reports_to` (inverse sugar)
- **Implicit chaining**: auto-chain by YAML declaration order when no deps specified
- **Filesystem state persistence**: JSON state, per-agent logs, orchestrator log, artifacts
- **Status recovery**: `/swarm status` reads persisted state across TUI restarts
- **Crash resilience**: state persisted after every mutation
- **TUI progress widget**: status icons, durations, error display, elapsed time
- **Standalone CLI**: `omp-swarm` with 5s polling, no timeout
- **LLM notification**: sends `swarm-result` custom message with pipeline summary
- **3-tier model resolution**: per-agent > swarm-default > session-default
- **Fault isolation**: one agent failure does not abort wave or pipeline
- **YAML-driven config**: no code changes needed for new swarm definitions

**Status**: pi-custom-pack has sequential subagent execution only. No DAG, no parallel waves, no state persistence.

### 2.5 Internal URL System (packages/coding-agent/src/internal-urls/)
11 protocol handlers that agents can use to access resources via special URIs:
- **omp://** — embedded documentation
- **agent://** — subagent output access with JSON path extraction
- **artifact://** — raw artifact access by numeric ID
- **memory://** — memory system access (summary, MEMORY.md, skills)
- **local://** — session-scoped scratch space (read/write)
- **vault://** — Obsidian vault access (files, outline, backlinks, tags, tasks, search, daily, orphans, properties)
- **skill://** — skill file access (SKILL.md + relative paths)
- **rule://** — rule content access
- **mcp://** — MCP server resources via URI templates
- **issue://** — GitHub issue access with SQLite caching
- **pr://** — GitHub PR access with diff support

Also includes: autocomplete system with fuzzy matching, jq-like JSON query parser, sealed secrets obfuscation.

**Status**: pi-custom-pack has none of these. No URI-based resource access for agents.

### 2.6 Tool Categories Missing from pi-custom-pack

#### Web Search (14 providers in oh-my-pi → 0 in pi-custom-pack)
- Anthropic, Perplexity, Exa, Brave, Jina, Kimi, Gemini, Codex, Tavily, Kagi, Z.AI, SearXNG, Synthetic

#### Browser Automation
- Headless CDP-based with tab supervisor, navigation, click, type, screenshot, evaluate JS

#### MCP Integration
- Dynamic tool discovery, resource URIs, server lifecycle management, timeout/retry

#### GitHub Integration
- Issues (create, list, search), PRs (create, diff), search code, commits, repos

#### LSP Integration
- Diagnostics, goto-definition, references, hover docs, symbols, rename, code actions

#### Image Generation
- 7 providers: Gemini, OpenAI, xAI/Grok, OpenRouter, Antigravity, etc.

#### Audio TTS
- xAI Grok Voice TTS with customizable voice, language, codec

#### SSH Remote Execution
- Key-based and password auth, command execution

#### Session Management
- Checkpoints (git-based), rewind, compaction, state persistence

#### Plugin/Marketplace System
- Extension loader, hook lifecycle (30+ events), skill hot-reload, marketplace discovery

#### Planning/Goals Mode
- Goal-oriented mode: create, get status, complete, resume, drop objectives

#### Code Intelligence
- AST-grep structural search/replace, tree-sitter syntactic queries, BM25 tool discovery

---

## 3. Prioritized Implementation Roadmap

### Phase 1: Foundation (Highest Impact, Lowest Effort)
**Est. time: 4-6 hours**

1. **Web Search System** — Implement with free-tier providers as fallback chain
   - Priority: Critical (agents need current info)
   - Providers: Tavily (free tier), SearXNG (self-hosted), Kagi (free trial), Brave (free tier)
   - Files: `assets/web/web-server.mjs` (TOOLS + executeTool + search functions)
   - Implementation: 3-4 functions, 1 tool definition

2. **Browser Automation** — Playwright-based headless browser tool
   - Priority: High (replaces paid Twitter API, enables web scraping)
   - Files: `assets/web/web-server.mjs` (TOOLS + browser tool), Playwright already installed
   - Implementation: Navigate, click, type, screenshot, extract text

3. **Rich File Editing** — Port hashline-style edit mode
   - Priority: High (dramatically improves code editing success rate)
   - Files: `assets/web/web-server.mjs` (edit modes), `assets/web/client/` (diff preview)
   - Key features: content-hash validation, boundary-balance repair, 3-way merge recovery

4. **MCP Integration** — MCP client to connect to external MCP servers
   - Priority: High (unlocks ecosystem of 1000+ MCP servers)
   - Implementation: JSON-RPC over stdio transport, tool discovery, resource access

### Phase 2: Core Intelligence (Medium Effort, High Impact)
**Est. time: 8-12 hours**

5. **Advanced Memory System** — Port mnemopi core
   - Embedding-based retrieval (use local Ollama or free API)
   - Entity extraction + triplestore
   - Beam search + MMR re-ranking
   - Veracity consolidation + contradiction detection
   - Memory banks (facts, procedures, preferences)
   - MCP server for memory access

6. **GitHub Integration** — Issues, PRs, code search, diffs
   - Via `gh` CLI (already installed) + REST API fallback
   - Internal URL protocols: `issue://`, `pr://`
   - SQLite caching for rendered markdown

7. **Internal URL System** — Protocol router for resource access
   - Start with: `memory://`, `vault://`, `issue://`, `pr://`, `local://`
   - Add: `omp://` (embedded docs), `skill://`, `rule://`, `mcp://`
   - Autocomplete with fuzzy matching

### Phase 3: Advanced Orchestration (High Effort, High Impact)
**Est. time: 10-15 hours**

8. **Swarm DAG Engine** — YAML-defined DAG-based multi-agent execution
   - Full DAG topology with cycle detection
   - Parallel wave execution
   - 3 modes: pipeline, parallel, sequential
   - Filesystem state persistence + recovery
   - Progress widget with status icons

9. **LSP Integration** — Code intelligence tools
   - Diagnostics, goto-definition, references, hover, symbols
   - Language server lifecycle management

10. **Session Management** — Checkpoints, rewind, compaction
    - Git-based checkpoint creation
    - Rewind to any checkpoint with report
    - Session compaction for long-running sessions

### Phase 4: Social & External Integration (Medium Effort)
**Est. time: 6-8 hours**

11. **Social Media Suite** — Reddit (free API), Bluesky (free API), Twitter (browser automation)
    - Already partially planned in FUTURE_IMPLEMENTATIONS.md
    - Add approval workflow before posting

12. **Email (Gmail) Integration** — OAuth 2.0 device flow, send/read
    - Already planned in FUTURE_IMPLEMENTATIONS.md

13. **Discord + Telegram** — Webhook/bot posting
    - Already planned in FUTURE_IMPLEMENTATIONS.md

### Phase 5: Polish & Specialized (Lower Priority)
**Est. time: 8-12 hours**

14. **Image Generation** — 3-4 provider support (OpenAI, Gemini, Grok)
15. **Audio TTS** — Text-to-speech via free API or local model
16. **SSH Remote Execution** — Key-based auth, command streaming
17. **Plugin/Marketplace System** — Extension loader with hook lifecycle
18. **Rust Native Addon** — For performance-critical operations (regex, glob, text rendering, AST)
19. **Mermaid Rendering** — Diagram generation
20. **SIXEL Terminal Support** — Image display in terminal

---

## 4. Detailed Feature Comparison Table

| Feature | oh-my-pi | pi-custom-pack | Priority |
|---------|----------|----------------|----------|
| File read/write/edit | hashline + AST-grep + plain | Plain search/replace | P1 |
| Web search | 14 providers | None | P0 |
| Web fetch | Multi-stage rendering pipeline | Basic webfetch | P0 |
| Browser automation | CDP headless (navigate, click, type, screenshot, eval) | None | P1 |
| Bash execution | Brush POSIX shell + PTY + output minimizer | Basic child_process | P2 |
| Code search | ripgrep-native + AST-grep + fuzzy find | Basic grep | P1 |
| File glob | .gitignore-aware + mtime sort + streaming | Basic glob | P1 |
| Memory | mnemopi (embeddings, beam, polyphonic, entities, triples, consolidation, banks) | Simple key-value | P1 |
| GitHub | Issues, PRs, diffs, search, commits, cache | None | P1 |
| LSP | Diagnostics, goto-def, references, hover, symbols, rename, code actions | None | P2 |
| MCP | Client with dynamic tool discovery, resource URIs, lifecycle | None | P1 |
| Internal URLs | 11 protocols (memory://, vault://, issue://, pr://, etc.) | None | P1 |
| Swarm orchestration | DAG + parallel waves + 3 modes + state persistence | Sequential only | P2 |
| Subagent execution | Full in-process agent session | Basic delegation | P2 |
| Image generation | 7 providers | None | P3 |
| Image inspection | EXIF, dimensions, metadata, thumbnails | None | P3 |
| Audio TTS | xAI Grok Voice | None | P3 |
| SSH | Key/password auth, command execution | None | P3 |
| Session management | Checkpoints, rewind, compaction | None | P2 |
| Approval workflow | Multi-tier, before external actions | None (planned M9) | P2 |
| Obsidian vault | Full structural queries (outline, backlinks, tags, tasks, search, etc.) | Basic read/write | P2 |
| Exa API | 18 tools (search, researcher, websets, enrichments, monitoring) | None | P3 |
| Mermaid rendering | SVG/PNG output | None | P3 |
| Plugin/marketplace | Extension loader, hook system, skill hot-reload | None | P3 |
| Planning/goals mode | Goal-oriented mode with objectives/token budgets | None | P2 |
| Code review | Structured finding reporting (P0-P3, confidence) | None | P3 |
| Task/job management | Async long-running tasks, goal management | None | P2 |
| IRC (inter-agent) | Real-time inter-agent messaging channel | agent_chat (basic) | P2 |
| Social posting | Twitter (planned browser auto) | Twitter API (blocked) | P2 |
| Reddit/Bluesky | Planned but not implemented | None | P2 |
| Email (Gmail) | Planned with OAuth device flow | None | P3 |
| YouTube transcript | Specialized web scraper for YouTube pages | None | P3 |
| Secret obfuscation | Regex/env detection + replace/obfuscate modes | None | P1 |
| Token counting | Embedded BPE tables (o200k_base, cl100k_base) | None | P2 |
| Code summarization | Tree-sitter structural → LLM context optimization | None | P2 |
| Syntax highlighting | Syntect-based, 11 categories | None | P3 |
| SIXEL terminal | Image→SIXEL encoding for terminal display | None | P3 |
| Keyboard protocol | Kitty protocol parsing/matching | None | P3 |
| Filesystem isolation | APFS, overlayfs, ZFS, btrfs, ProjFS, reflink, rcopy | None | P3 |
| Process management | Cross-platform process tree, kill, enumerate | None | P3 |
| Power management | macOS IOKit power assertions (prevent sleep) | None | P3 |
| Appearance detection | macOS dark/light mode observer | None | P3 |
| Profiling | Always-on circular buffer profiler | None | P3 |
| HTML→Markdown | Rust-native conversion for AI context | We have webfetch | P2 |
| BM25 tool search | Discoverable tool invocation at runtime | None | P3 |

---

## 5. Key Architecture Differences

### Agent Loop
- **oh-my-pi**: Full `AgentSession` wrapping `Agent` from `pi-agent-core` with hooks, modes, extensions, MCP, tool routing, internal URLs, memory, compaction. 50K+ lines of TypeScript.
- **pi-custom-pack**: Simple `executeTool()` switch with 15 cases. No hooks, no extensions, no modes, no internal URLs.

### UI
- **oh-my-pi**: Full TUI built on `@oh-my-pi/tui` package (custom terminal rendering library). Components: box, loader, markdown, editor, input, select-list, settings-list, tab-bar, text, spacer, truncated-text. Uses kitty keyboard protocol, sixel images, bracketed paste.
- **pi-custom-pack**: Web UI (React + Vite + TypeScript). Components: SubAgentPanel, ToolCallCard, QuestionModal, AgentChat. Basic status display.

### Execution Model
- **oh-my-pi**: In-process subagent sessions with full tool access, LSP, memory. `runSubprocess()` creates a complete agent session.
- **pi-custom-pack**: Sequential JS loop calling `streamSimple()` with tool execution in between. No subagent tool access, no LSP, no memory.

### Configuration
- **oh-my-pi**: `.omp/` directory with settings, skills, rules, hooks, extensions, MCP config. Multiple config roots (.omp, .claude, .codex, .gemini). Global + project override.
- **pi-custom-pack**: Plain JavaScript file, hardcoded settings.

---

## 6. Implementation Recommendations

### Immediate (Do Next)
1. **Phase 1.1: Web Search System** — Essential for agent autonomy. Implement with Tavily (free tier) as primary, SearXNG as fallback. Single `web_search` tool definition with query parameter.
2. **Phase 1.2: Browser Tool** — Playwright is already installed. Implement navigate/click/type/screenshot/extract. Replaces paid Twitter API for posting.
3. **Phase 1.3: MCP Client** — Enables connecting to 1000+ existing MCP servers (filesystem, git, database, etc.) without writing new tool code.

### Short-term (This Week)
4. **Phase 1.3: Hashline Edit Mode** — Content-hash validation, boundary-balance repair, 3-way merge. Dramatically improves file editing reliability.
5. **Phase 2.1: GitHub Integration** — Issues + PRs via `gh` CLI. Internal URL protocols for agent access.
6. **Phase 2.2: Memory Upgrade** — Embedding-based retrieval + entity extraction + triplestore + consolidation.

### Medium-term (Next Week)
7. **Phase 2.3: Internal URL System** — Protocol router for memory://, vault://, issue://, pr://
8. **Phase 3.1: Swarm DAG** — YAML-defined DAG orchestration with parallel waves
9. **Phase 3.2: LSP Integration** — Diagnostics, goto-def, references

### Long-term
10. Phase 4: Social media suite + Email
11. Phase 5: Image gen, TTS, SSH, plugin system, Rust natives
