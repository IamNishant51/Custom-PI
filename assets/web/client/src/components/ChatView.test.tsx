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
    expect(screen.getByText("> What can you do?")).toBeDefined();
    expect(screen.getByText("> Explain codebase")).toBeDefined();
    expect(screen.getByText("> Review products")).toBeDefined();
  });

  it("renders the input area when connected", () => {
    render(<ChatView />);
    const textarea = document.querySelector(".chat-input");
    expect(textarea).toBeDefined();
    expect(textarea?.getAttribute("placeholder")).toBe("Ask me anything...");
  });
});
