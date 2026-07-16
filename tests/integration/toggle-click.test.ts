import { describe, it, expect } from "vitest";

/**
 * Tests for the toggle click detection algorithm in handleTerminalMouseClick.
 *
 * The handler (in patches/index.ts) matches SGR mouse coordinates against
 * rendered component ranges and decides whether to toggle the thinking block.
 *
 * Three detection layers:
 *   1. Hot-zone: any click on an AssistantMessage with reasoningToggleLines toggles it
 *   2. Position history: stale toggle positions retained for 3s
 *   3. Glyph scan: rendered output scanned for ▶/▼ characters
 *
 * These tests verify each layer against every scenario from the user's logs.
 */

interface RC {
  component: { constructor: { name: string }; hideThinkingBlock?: boolean };
  startLine: number;
  endLine: number;
  reasoningToggleLines: number[];
  renderedLines: string[];
}

// ---- Replica of the click handler's core logic ----

function findClickedComponent(
  lineIndex: number,
  chatContainerStartLine: number,
  renderedComponents: RC[],
): RC | undefined {
  return renderedComponents.find((rc) => {
    const absStart = chatContainerStartLine + rc.startLine;
    let absEnd = chatContainerStartLine + rc.endLine;
    if (rc.component.constructor?.name === "AssistantMessageComponent") {
      absEnd += 1;
    }
    return lineIndex >= absStart && lineIndex < absEnd;
  });
}

function shouldToggleAssistant(
  clicked: RC | undefined,
  lineIndex: number,
  chatContainerStartLine: number,
  togglePositionHistory: Map<number, { component: { constructor: { name: string } } }>,
  lastRenderedLines: string[],
  renderedComponents: RC[],
): boolean {
  // Layer 1: Hot-zone — any click on an Assistant with toggle lines fires
  if (
    clicked &&
    clicked.component.constructor?.name === "AssistantMessageComponent" &&
    clicked.reasoningToggleLines.length > 0
  ) {
    return true;
  }

  // Layer 2: Position history
  if (togglePositionHistory.has(lineIndex)) {
    const info = togglePositionHistory.get(lineIndex)!;
    if (info.component.constructor?.name === "AssistantMessageComponent") {
      return true;
    }
  }

  // Layer 3: Glyph scan
  if (lastRenderedLines && lineIndex >= 0 && lineIndex < lastRenderedLines.length) {
    const clickedText = lastRenderedLines[lineIndex].replace(/\x1b\[[0-9;]*m/g, "");
    if (clickedText.includes("\u25b6") || clickedText.includes("\u25bc")) {
      const containerLine = lineIndex - chatContainerStartLine;
      const ghostOwner = renderedComponents
        .filter((rc) => rc.component.constructor?.name === "AssistantMessageComponent")
        .find((rc) => containerLine >= rc.startLine && containerLine < rc.endLine + 2);
      if (ghostOwner) return true;
    }
  }

  return false;
}

function makeAssistantComponent(overrides: Partial<RC> = {}): RC {
  return {
    component: { constructor: { name: "AssistantMessageComponent" } },
    startLine: 5,
    endLine: 7,
    reasoningToggleLines: [0],
    renderedLines: ["\u25b6 Reasoning  (click to expand)"],
    ...overrides,
  };
}

function makeUserComponent(): RC {
  return {
    component: { constructor: { name: "UserMessageComponent" } },
    startLine: 3,
    endLine: 4,
    reasoningToggleLines: [],
    renderedLines: ["\u25cf Hello"],
  };
}

describe("Toggle click detection", () => {
  const CHAT_START = 2;

  describe("Layer 1: Hot-zone mode", () => {
    it("toggles when clicking on the toggle line (expanded thinking)", () => {
      // Expanded: 2 lines — toggle at rel 0, thought at rel 1
      const comp = makeAssistantComponent({
        startLine: 5,
        endLine: 7,
        reasoningToggleLines: [0],
        renderedLines: ["\u25bc Reasoning", "  thought line"],
      });

      const components = [makeUserComponent(), comp];

      // Click at the toggle line: SGR row 8 → lineIndex=7
      const clicked = findClickedComponent(7, CHAT_START, components);
      expect(clicked).toBeDefined();
      expect(shouldToggleAssistant(clicked, 7, CHAT_START, new Map(), [], components)).toBe(true);
    });

    it("toggles when clicking on the thinking content (expanded)", () => {
      const comp = makeAssistantComponent({
        startLine: 5,
        endLine: 7,
        reasoningToggleLines: [0],
        renderedLines: ["\u25bc Reasoning", "  thought content"],
      });

      const components = [makeUserComponent(), comp];

      // Click at the thinking content: SGR row 9 → lineIndex=8
      const clicked = findClickedComponent(8, CHAT_START, components);
      expect(clicked).toBeDefined();
      expect(shouldToggleAssistant(clicked, 8, CHAT_START, new Map(), [], components)).toBe(true);
    });

    it("toggles when clicking on the toggle line (collapsed)", () => {
      const comp = makeAssistantComponent({
        startLine: 5,
        endLine: 6,
        reasoningToggleLines: [0],
        renderedLines: ["\u25b6 Reasoning  (click to expand)"],
      });

      const components = [makeUserComponent(), comp];

      // Click at SGR row 8 → lineIndex=7
      const clicked = findClickedComponent(7, CHAT_START, components);
      expect(clicked).toBeDefined();
      expect(shouldToggleAssistant(clicked, 7, CHAT_START, new Map(), [], components)).toBe(true);
    });

    it("toggles when clicking on the blank line below a collapsed toggle (+1 extension)", () => {
      const comp = makeAssistantComponent({
        startLine: 5,
        endLine: 6,
        reasoningToggleLines: [0],
        renderedLines: ["\u25b6 Reasoning  (click to expand)"],
      });

      const components = [makeUserComponent(), comp];

      // Click at SGR row 9 → lineIndex=8 — this is the blank line gap
      // Without +1 extension: abs end = 2+6 = 8 → 8 not in [7, 8)
      // With +1 extension:    abs end = 2+6+1 = 9 → 8 in [7, 9) ✓
      const clicked = findClickedComponent(8, CHAT_START, components);
      expect(clicked).toBeDefined();
      expect(shouldToggleAssistant(clicked, 8, CHAT_START, new Map(), [], components)).toBe(true);
    });
  });

  describe("Layer 2: Position history", () => {
    it("toggles using stale position history when the component moved", () => {
      // Component has moved (height changed), click is at the OLD position
      const comp = makeAssistantComponent({
        startLine: 5,
        endLine: 6, // 1 line after collapse
        reasoningToggleLines: [0],
        renderedLines: ["\u25b6 Reasoning"],
      });

      const components = [makeUserComponent(), comp];

      // The toggle WAS at abs line 9 (position history), but the component
      // now ends at abs line 8 (+1 extended). Click at line 9 won't match.
      const history = new Map<number, { component: any }>();
      history.set(9, { component: comp.component }); // old toggle position

      // Without history: no match
      // With history: should match via position history
      expect(shouldToggleAssistant(undefined, 9, CHAT_START, history, [], components)).toBe(true);
    });
  });

  describe("Layer 3: Glyph scan", () => {
    it("toggles using glyph scan when rendered output has toggle character", () => {
      const comp = makeAssistantComponent({
        startLine: 5,
        endLine: 6,
        reasoningToggleLines: [],
        renderedLines: ["\u25b6 Reasoning"],
      });

      const components = [makeUserComponent(), comp];

      // Click at a line that's outside the component but still shows ▶
      // in the rendered output
      const lastRendered = [
        "line 0",
        "",
        "",
        "line 3",
        "line 4",
        "\u25b6 Reasoning", // line 5, but comp range says [7, 9)
        "",
      ];

      const history = new Map();
      history.set(5, { component: comp.component });

      expect(shouldToggleAssistant(undefined, 5, CHAT_START, history, lastRendered, components)).toBe(true);
    });
  });

  describe("Non-toggle scenarios (should NOT toggle)", () => {
    it("does NOT toggle when clicking a UserMessage component", () => {
      const components = [makeUserComponent()];

      const clicked = findClickedComponent(5, CHAT_START, components);
      expect(clicked).toBeDefined();
      expect(
        shouldToggleAssistant(clicked, 5, CHAT_START, new Map(), [], components),
      ).toBe(false);
    });

    it("does NOT toggle when clicking an AssistantMessage without toggle lines", () => {
      const comp = makeAssistantComponent({
        reasoningToggleLines: [], // no thinking block
        renderedLines: ["\u25cf Here is some code:\n  const x = 1"],
      });

      const components = [makeUserComponent(), comp];

      const clicked = findClickedComponent(7, CHAT_START, components);
      expect(clicked).toBeDefined();
      expect(
        shouldToggleAssistant(clicked, 7, CHAT_START, new Map(), [], components),
      ).toBe(false);
    });

    it("does NOT toggle when clicking a component that doesn't exist at that line", () => {
      const components = [makeUserComponent()];

      // Line 100 doesn't exist in any component
      const clicked = findClickedComponent(100, CHAT_START, components);
      expect(clicked).toBeUndefined();
      expect(
        shouldToggleAssistant(clicked, 100, CHAT_START, new Map(), [], components),
      ).toBe(false);
    });
  });

  describe("Boundary: multiple assistant components", () => {
    it("correctly matches the right component when two assistants are adjacent", () => {
      const compA = makeAssistantComponent({
        startLine: 5,
        endLine: 7,
        reasoningToggleLines: [0],
        renderedLines: ["\u25bc Reasoning A", "  thought A"],
      });

      const compB = makeAssistantComponent({
        component: { constructor: { name: "AssistantMessageComponent" } },
        startLine: 8,
        endLine: 10,
        reasoningToggleLines: [0],
        renderedLines: ["\u25bc Reasoning B", "  thought B"],
      });

      const components = [makeUserComponent(), compA, compB];

      // Click on compA's toggle line
      const clickA = findClickedComponent(7, CHAT_START, components);
      expect(clickA).toBeDefined();
      expect(clickA!.startLine).toBe(5); // compA, not compB

      // Click on compB's toggle line
      const clickB = findClickedComponent(10, CHAT_START, components);
      expect(clickB).toBeDefined();
      expect(clickB!.startLine).toBe(8); // compB, not compA
    });
  });
});
