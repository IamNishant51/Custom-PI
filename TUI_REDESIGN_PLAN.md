# CUSTOM-PI TUI Redesign Plan

## Goal
Transform the terminal experience from functional box-drawing panels into a fluid, modern, animated TUI that rivals Claude Code and oh-my-pi — while preserving the **custom-pi ASCII banner** as the branding cornerstone.

---

## 🔷 Guiding Principles

| Principle | Description |
|-----------|-------------|
| **Brand First** | The ASCII banner stays. It's the identity. Everything wraps around it. |
| **60fps Smooth** | Double-buffered rendering with cell-level diffing. No flicker, no tearing. |
| **React Declarative** | Adopt Ink-style React reconciler for terminal rendering. Components, not string concatenation. |
| **Graceful Degradation** | Works on any terminal. Extra features (Kitty protocol, mouse, images) on capable terminals. |
| **Zero Dep Bloat** | Build rendering core ourselves. No `ink` npm dependency — fork the concepts, keep ~100KB. |

---

## 🏗 Architecture

### Current (simplified)
```
console.log() → stdout
    ↓
String concatenation + ANSI codes
    ↓
No layout engine, no diffing, no frame management
```

### Target
```
React JSX → Terminal Reconciler → Yoga Layout → Screen Buffer → Diff Engine → ANSI Escape Sequences → stdout
    │              │                    │              │             │
    │    Custom react-reconciler   Flexbox layout    Uint32Array   Cell-by-cell
    │    host config              (compiled inline)  packed cells  Int32 compare
```

---

## 🔷 Phase 1: Rendering Engine (Core)

### 1.1 `TerminalScreen` — Double-Buffered Character Grid

Replace all `console.log` / direct stdout writes with a managed screen buffer.

```typescript
interface Cell {
  char: number       // Unicode codepoint
  style: number      // Packed style ID (fg, bg, bold, italic, etc.)
  width: number      // 1 or 2 (CJK/emoji)
}

class TerminalScreen {
  // Two Uint32Array buffers: front + back
  // Each cell packed into 2x Int32 (char+style, width+flags)
  private front: Uint32Array  // currently displayed
  private back: Uint32Array   // being rendered to

  resize(cols: number, rows: number): void
  write(x: number, y: number, char: number, style: number): void
  flush(): string  // diff front vs back → ANSI escape sequence string
  clear(): void
}
```

**Packed cell format** (2 × Int32 = 8 bytes per cell):
```
Word 0: [char: 21 bits][style: 11 bits]
Word 1: [width: 2 bits][flags: 6 bits][reserved: 24 bits]
```

For a 200×120 terminal: 200 × 120 × 8 = 192KB per buffer × 2 = 384KB total. Fits in L2 cache.

### 1.2 `StylePool` — Interned Style IDs

Instead of carrying full ANSI strings, assign integer IDs to unique style combinations.

```typescript
class StylePool {
  private styles: StyleDef[] = []  // index = style ID
  private cache = new Map<string, number>()  // serialized → id

  getOrCreate(def: StyleDef): number
  transition(from: number, to: number): string  // cached ANSI diff
}
```

**StyleDef** packed into bits:
```
[fg: 8 bits][bg: 8 bits][bold:1][dim:1][italic:1][underline:1][inverse:1][strikethrough:1]
```

### 1.3 `AnsiWriter` — Smart ANSI Output

Optimizes terminal writes by minimizing escape sequence output.

- **Merges adjacent writes** on same row into single `cursorMove + text`
- **Strips redundant resets** — if style doesn't change between cells, skip style emit
- **Synchronized updates** — wraps frame in BSU/ESU (`ESC[?2026h`/`l`) when terminal supports it
- **Autowrap management** — disables during frame paint, restores after

### 1.4 Frame Pipeline

Order:
1. **React commit** → component state changes trigger `resetAfterCommit`
2. **Yoga layout** → calculate positions + sizes for all nodes
3. **DOM-to-screen** → walk tree, write cells to back buffer
4. **Diff** → compare back vs front, collect changed cell regions
5. **Optimize** → merge adjacent patches, minimize cursor moves
6. **Write** → single `stdout.write()` call with BSU/ESU wrapping

---

## 🔷 Phase 2: Component System

### 2.1 Base Components

A minimal set of primitive components, similar to Ink but with our own reconciler:

| Component | Purpose |
|-----------|---------|
| `<Root>` | Document root, one per TUI instance |
| `<Box>` | Flexbox container (Yoga layout) |
| `<Text>` | Text node with word wrapping |
| `<VirtualText>` | Nested styled text inside Text |
| `<AnsiBlock>` | Pre-rendered ANSI content (code blocks) |
| `<Spacer>` | Empty space |

```typescript
// Virtual DOM node types
type InkNodeType =
  | "ink-root"       // document root
  | "ink-box"        // flex container
  | "ink-text"       // text with word wrap
  | "ink-virtual-text" // inline styled text
  | "ink-ansi-block" // pre-rendered content
```

### 2.2 React Reconciler (Custom)

Build using `react-reconciler` (React's host config API):

```typescript
import ReactReconciler from "react-reconciler";

const hostConfig: HostConfig<InkNodeType, InkNode, ...> = {
  createInstance(type, props, ...) {
    return new InkNode(type, props);
  },
  appendChild(parent, child) { parent.appendChild(child); },
  // ... all host config methods
};

const reconciler = ReactReconciler(hostConfig);
```

### 2.3 Yoga Layout (Compiled Wrapper)

In-bundle flexbox via a stripped-down Yoga compiled to WASM or a pure-JS flexbox implementation:

```typescript
class YogaNode {
  flexDirection: "row" | "column"
  alignItems: "flex-start" | "center" | "flex-end"
  justifyContent: "flex-start" | "center" | "flex-end" | "space-between"
  padding: [top, right, bottom, left]
  margin: [top, right, bottom, left]
  width: number | "auto"
  height: number | "auto"
  flexGrow: number

  calculateLayout(): void
  getComputedLeft(): number
  getComputedTop(): number
  getComputedWidth(): number
  getComputedHeight(): number
}
```

---

## 🔷 Phase 3: Application Components

### 3.1 Message/Chat Bubbles

Replace raw box-drawing with rich message components:

```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ ● You                               12:34│ │
│ │                                         │ │
│ │  implement a fibonacci function in Go   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ ● Assistant       ● tools: 3 ● 3.2s 12:35│ │
│ │                                         │ │
│ │  Here's a Fibonacci function in Go:     │ │
│ │                                         │ │
│ │  ┌─────────────────────────────────────┐│ │
│ │  │ func fib(n int) int {               ││ │
│ │  │   if n <= 1 { return n }            ││ │
│ │  │   return fib(n-1) + fib(n-2)        ││ │
│ │  │ }                                   ││ │
│ │  └─────────────────────────────────────┘│ │
│ │                                         │ │
│ │  This is a recursive approach. For a    │ │
│ │  more efficient version...              │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

**Message bubble features:**
- **Rounded corners** via `╭╮╰╯` for the outer container
- **Header strip** — avatar dot + name + tool call count + duration + timestamp
- **Left-aligned user messages**, left-aligned assistant (claude style)
- **Code blocks** with language label header + syntax highlighting
- **Collapsible tool results** — show summary, `▶ 3 more lines` expand
- **Streaming indicator** — animated `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` while tokens arrive
- **Shimmer border** on assistant messages while streaming (animated gradient border)

### 3.2 Input Area

A modern, feature-rich prompt input at the bottom:

```
┌─────────────────────────────────────────────┐
│ ╭─────────────────────────────────────────╮ │
│ │ write a fibonacci function in...        │ │
│ ╰─────────────────────────────────────────╯ │
│ [Ctrl+Enter to send]  [Tab: autocomplete]   │
└─────────────────────────────────────────────┘
```

**Input features:**
- **Multi-line editor** with word wrap (oh-my-pi Editor-style)
- **Vim mode** (INSERT/NORMAL/VISUAL) with mode indicator
- **Autocomplete** — file paths (`@`), slash commands (`/`), with fuzzy matching
- **Inline suggestion** — ghost text showing completion (dimmed)
- **Line numbers** in gutter when multi-line
- **Kill ring** — Emacs-style cut/yank with history
- **Undo/redo** stack
- **History navigation** — Up/Down arrows
- **Bracketed paste** support
- **Horizontal scrolling** within long lines

### 3.3 Agent Swarm Panels

Replace the current box-drawing agent panels with modern bordered cards:

```
┌─────────────────────────────────────────────┐
│ ╭─ ● Builder ────────────────── ◷ 12.3s ─╮ │
│ │  Cooking...  web_search: 3 · write: 2   │  │
│ │  ─────────────────────────────────────  │  │
│ │  Searching for Go concurrency patterns. │  │
│ │  Next: Implement the worker pool...     │  │
│ ╰─────────────────────────────────────────╯ │
│ ╭─ ● Researcher ── ◴ waiting for builder ╮ │
│ ╰─────────────────────────────────────────╯ │
└─────────────────────────────────────────────┘
```

**Card features:**
- **Animated border** (oh-my-pi style) for running agents — shimmer travels clockwise
- **Status icon**: ● running, ✓ success, ✗ error, ◴ waiting, ○ idle
- **Duration** in header
- **Tool call count** pills
- **Expanded/collapsed** — collapsible sections with output
- **Parallel view** — side-by-side when width > 160

### 3.4 Status Bar / Footer

A persistent status bar at the bottom of the screen (like vim's statusline):

```
┌─────────────────────────────────────────────┐
│ NORMAL  │ memory: 142 facts · vault: 12 keys │ $0.04 · tokens: 1,234 │ 80x24 │
└─────────────────────────────────────────────┘
```

**Status bar features:**
- **Mode indicator** (NORMAL/INSERT/VISUAL) — colored by mode
- **Agent status** — running/idle/waiting with dot indicator
- **Storage stats** — memory count, vault keys
- **Cost display** — session cost, token count
- **Terminal size** — cols × rows
- **Clock** — current time

### 3.5 Banner / Header

Preserve the custom-pi ASCII banner. Enhanced rendering:

```
  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗
 ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║
 ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║
 ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║
 ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║
  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝
```

**Banner features:**
- **Gradient colors** matching terminal ANSI: pink `#ff0087` → magenta `#ff00ff` → purple `#af5fff` → deep blue `#5f00ff` → cyan `#00ffff` → teal `#00d7ff`
- **Animated sparkle** — subtle star `✦` particles drift across the banner on startup
- **Responsive** — shrinks to 3-line compact version on narrow terminals (<60 cols)
- **Fade-in animation** on first render (opacity 0→1 via ANSI dim→bright)

### 3.6 Permission Dialogs

Interactive confirmation dialogs (from approval workflow):

```
┌─────────────────────────────────────────────┐
│ ╭─ ⚠ Tool Request ────────────────────────╮ │
│ │                                          │ │
│ │  Write to /home/user/src/main.go?        │ │
│ │                                          │ │
│ │  ┌─ File: main.go ─────────────────────┐ │ │
│ │  │ func fib(n int) int {               │ │ │
│ │  │   return n + 1                      │ │ │
│ │  │ }                                   │ │ │
│ │  └─────────────────────────────────────┘ │ │
│ │                                          │ │
│ │   > Allow           Deny         Always   │ │
│ │                                          │ │
│ ╰──────────────────────────────────────────╯ │
└─────────────────────────────────────────────┘
```

- **Highlighted diff** — green additions, red deletions
- **Selection via Tab/arrows** — highlighted option with cursor
- **Timeout countdown** — auto-deny after 120s with visual timer

---

## 🔷 Phase 4: Animations & Visual Effects

### 4.1 Spinner System

Replace simple frame cycling with multi-cadence spinners:

| Spinner | Frames | Cadence | Usage |
|---------|--------|---------|-------|
| **Thinking** | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | 80ms | Default LLM thinking |
| **Dot pulse** | `⣾⣽⣻⢿⡿⣟⣯⣷` | 100ms | Waiting for tool result |
| **Bouncing bar** | `█▇▆▅▄▃▂▁` | 60ms | File operation in progress |
| **Breathe** | `◐◓◑◒` | 200ms | Idle / waiting |
| **Shimmer** | gradient traveling across a line | 16ms per step | Border animation |
| **Sparkle** | `✦✧⋆` particles | 50ms | Transitions and highlights |

### 4.2 Border Animations

Inspired by oh-my-pi's `output-block.ts`:
- **Shimmer border** — a bright segment (8 cells) travels clockwise around the border
- **Full lap**: ~4000ms with ease-in-out at corners
- **States**: running → accent color, success → green, error → red, waiting → dim
- **Pulse** — border brightness oscillates for waiting states

### 4.3 Transition Animations

- **Message appear** — new messages fade in (dim→bright over 200ms)
- **Panel expand** — height animates with content reveal
- **Status transitions** — spinner → checkmark with brief green flash
- **Scroll** — smooth via DEC scroll regions `CSI ; r`

### 4.4 Streaming Effects

While LLM tokens stream in:
- **Typewriter effect** — tokens arrive character by character (terminal does this naturally, but we can add:)
- **Shimmer cursor** — subtle animated `▍` insertion point before the latest token
- **Header pulse** — the message header's spinner dot pulses during streaming

---

## 🔷 Phase 5: Input & Interaction

### 5.1 Key Handling

Full key parsing pipeline (oh-my-pi inspired):
```
raw bytes → StdinBuffer → tokenizer → protocol parser → keybinding resolver → handler
```

Supported protocols:
- **Legacy** — CSI, SS3, raw ASCII
- **Kitty** — progressive enhancement via `\x1b[>1u` → `\x1b[>2u` → `\x1b[>9999u`
- **DEC** — mouse tracking (1000/1002/1003), focus events (1004), bracketed paste (2004)
- **OSC** — clipboard (52), terminal notifications

### 5.2 Vim Mode

| Mode | Feature |
|------|---------|
| **NORMAL** | `h/j/k/l` navigation, `i` insert, `v` visual, `:` commands, `/` search |
| **INSERT** | Standard text input, `Esc` → NORMAL, `Ctrl+[` alternative |
| **VISUAL** | Character selection, `d` delete, `y` yank, `c` change |

Typed state machine:
```typescript
type VimMode = "normal" | "insert" | "visual"
type VimState = {
  mode: VimMode
  pendingKeys: string[]       // for multi-key sequences like `gg`, `dd`
  lastMotion: string          // for dot-repeat
  register: string            // active register
}
```

### 5.3 Mouse Support (Fullscreen Mode)

Enable via DECSET 1002 (cell motion tracking):
- **Click** — position cursor, focus input, select option
- **Drag** — text selection with auto-copy on release
- **Wheel** — scroll through conversation
- **Double-click** — word selection
- **Scrollbar** — drag to navigate (terminal mouse reporting)

---

## 🔷 Phase 6: File Structure

```
assets/extensions/subagents/src/tui/
├── index.ts                    # Re-exports
├── types.ts                    # Core types (Cell, StyleDef, InkNode, etc.)
├── screen.ts                   # TerminalScreen — double-buffered grid
├── style-pool.ts               # StylePool — packed ANSI interning
├── ansi-writer.ts              # AnsiWriter — optimized ANSI output
├── reconciler.ts               # React host config
├── yoga.ts                     # Flexbox layout (simplified)
├── ink-node.ts                 # InkNode virtual DOM class
├── components/
│   ├── root.tsx                 # <Root>
│   ├── box.tsx                  # <Box>
│   ├── text.tsx                 # <Text>
│   ├── spacer.tsx               # <Spacer>
│   └── ansi-block.tsx           # <AnsiBlock>
├── app/
│   ├── banner.tsx               # ASCII banner with gradient + sparkle
│   ├── chat-message.tsx         # Message bubble component
│   ├── chat-stream.tsx          # Streaming message handler
│   ├── chat-history.tsx         # Virtual scrolled message list
│   ├── input-area.tsx           # Prompt input with vim mode
│   ├── agent-card.tsx           # Agent swarm panel
│   ├── status-bar.tsx           # Footer status line
│   ├── permission-dialog.tsx    # Approval dialog
│   └── autocomplete-popup.tsx   # Autocomplete dropdown
├── hooks/
│   ├── use-animation-frame.ts   # requestAnimationFrame hook
│   ├── use-blink.ts             # Blink animation hook
│   ├── use-terminal-size.ts     # Resize listener
│   ├── use-virtual-scroll.ts    # Virtual viewport calculator
│   ├── use-vim-input.ts         # Vim state machine
│   └── use-elapsed-time.ts      # Duration display
├── input/
│   ├── keys.ts                  # Key parsing (CSI, Kitty, DEC)
│   ├── keybindings.ts           # Keybinding registry
│   ├── stdin-buffer.ts          # Raw byte reassembly
│   ├── bracketed-paste.ts       # Paste buffer
│   └── kill-ring.ts             # Cut/yank ring buffer
├── utils/
│   ├── measure-text.ts          # Unicode/grapheme width calc
│   ├── wrap-text.ts             # Word wrapping with ANSI
│   ├── truncate.ts              # Width truncation
│   └── colors.ts                # Theme color definitions
└── __tests__/
    ├── screen.test.ts
    ├── style-pool.test.ts
    └── ...
```

---

## 🔷 Phase 7: Migration Strategy

### Step 1: Rendering Foundation (Week 1)
- Build `TerminalScreen` with packed Uint32Array cells
- Build `StylePool` with style interning
- Build `AnsiWriter` with smart diff output
- Replace all `console.log` output with screen buffer writes
- **Deliverable**: flicker-free rendering at 60fps

### Step 2: Component System (Week 2)
- Implement React reconciler host config
- Build `<Box>`, `<Text>`, `<Root>` components
- Integrate Yoga flexbox layout
- **Deliverable**: Declarative component rendering

### Step 3: Application Shell (Week 3)
- Port banner component
- Build status bar
- Build message bubble component
- Build input area with vim mode
- **Deliverable**: Feature-complete TUI shell

### Step 4: Animations & Polish (Week 4)
- Implement all spinner animations
- Add border shimmer effects
- Add transition animations
- Implement virtual scrolling
- **Deliverable**: Production-ready animated TUI

### Step 5: Interaction Layer (Week 5)
- Full keybinding system
- Mouse support (fullscreen mode)
- Autocomplete popup
- Permission dialogs
- Agent swarm cards
- **Deliverable**: Complete TUI redesign

---

## 🔷 Phase 8: Performance Targets

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Render frame time | ~50ms (full repaint) | <16ms (60fps) | Cell-level diffing |
| Steady-state frame | ~50ms | <1ms | Blit optimization |
| Memory (200×120) | unbounded | <2MB | Packed buffers + pools |
| Scroll performance | full repaint | O(viewport) | Virtual scrolling |
| Input latency | ~50ms | <8ms | Key priority queue |
| Startup time | ~500ms | <200ms | Lazy component init |

---

## 🔷 Theme System

```typescript
const THEME = {
  // Banner gradient (6 lines)
  banner: ["#ff0087", "#ff00ff", "#af5fff", "#5f00ff", "#00ffff", "#00d7ff"],

  // Semantic colors
  accent: "#ff7a17",
  success: "#30d158",
  warning: "#ff9f0a",
  error: "#ff3b30",
  info: "#5ac8fa",

  // Surfaces
  canvas: "#0a0a0a",
  surface: "#1a1c20",
  card: "#191919",
  hairline: "#212327",

  // Text
  ink: "#ffffff",
  muted: "#7d8187",
  dim: "#4e5257",

  // Message bubbles
  userBubble: "#1a1c20",
  assistantBubble: "#191919",
  userBubbleBorder: "#212327",
  assistantBubbleBorder: "#2c2f34",

  // Agent states
  agentRunning: "#ff7a17",
  agentSuccess: "#30d158",
  agentError: "#ff3b30",
  agentWaiting: "#7d8187",
};
```

---

## 🔷 Comparison: Current vs Redesigned

| Aspect | Current | Redesigned |
|--------|---------|------------|
| **Rendering** | `console.log()` per frame | Double-buffered Uint32Array screen |
| **Layout** | String concatenation with padding | Yoga flexbox engine |
| **Components** | Functions returning strings | React components with JSX |
| **Diffing** | None (full repaint) | Cell-by-cell Int32 compare |
| **Animations** | `setInterval` @ 80ms | `requestAnimationFrame` + multi-cadence |
| **Input** | Basic raw stdin | Vim/Emacs modes, autocomplete, kill ring |
| **Messages** | Plain text with ANSI | Styled bubbles with headers, timestamps, pills |
| **Borders** | Unicode box drawing with fixed color | Animated shimmer borders, state-based |
| **Agent panels** | Box-drawn panels | Animated cards with expand/collapse |
| **Scrolling** | Terminal native scrollback | Virtual viewport + DEC scroll regions |
| **Mouse** | None | Click, drag-select, wheel scroll |
| **Images** | None | Kitty/iTerm2 protocol on capable terminals |
| **Branding** | ASCII banner (keep) | ASCII banner with gradient + sparkle animation |
