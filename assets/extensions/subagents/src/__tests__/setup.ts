import { vi } from "vitest";

// Mock fetch for embedding tests
vi.stubGlobal("fetch", vi.fn());

// Mock @earendil-works/pi-ai for background-review/curator tests
const mockResponse = {
  content: [{ type: "text", text: "NO_UPDATE" }],
  usage: {},
  stopReason: "end_turn",
};
vi.mock("@earendil-works/pi-ai", () => ({
  completeSimple: vi.fn().mockResolvedValue(mockResponse),
  streamSimple: vi.fn(),
}));
