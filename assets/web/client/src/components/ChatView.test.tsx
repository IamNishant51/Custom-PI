import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatView from "./ChatView";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("../context/ChatContext", () => ({
  useChat: () => ({
    items: [],
    loading: false,
    input: "",
    setInput: vi.fn(),
    sendMessage: vi.fn(),
    sendInterrupt: vi.fn(),
    connected: true,
  }),
}));

describe("ChatView", () => {
  it("renders the empty state with ASCII banner", () => {
    render(<ChatView />);
    expect(screen.getByText("CUSTOMIZED PI CODING AGENT")).toBeDefined();
  });

  it("renders action chips in empty state", () => {
    render(<ChatView />);
    const chips = document.querySelectorAll(".action-chip");
    expect(chips.length).toBe(8);
    expect(chips[0].textContent).toContain("What can you do?");
    expect(chips[1].textContent).toContain("Explain the codebase structure");
  });

  it("renders the input area when connected", () => {
    render(<ChatView />);
    const textarea = document.querySelector(".chat-input");
    expect(textarea).toBeDefined();
    expect(textarea?.getAttribute("placeholder")).toBe("Ask me anything... (type / for commands)");
  });
});
