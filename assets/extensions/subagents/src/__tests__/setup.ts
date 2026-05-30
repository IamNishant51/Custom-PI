import { vi } from "vitest";

// Mock fetch for embedding tests
vi.stubGlobal("fetch", vi.fn());

// Mock @earendil-works/pi-ai for background-review/curator tests
vi.mock("@earendil-works/pi-ai", () => ({
  completeSimple: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "NO_UPDATE" }],
    usage: {},
    stopReason: "end_turn",
  }),
}));
