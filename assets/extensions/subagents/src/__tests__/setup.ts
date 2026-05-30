import { vi } from "vitest";

// Mock fetch for embedding tests
vi.stubGlobal("fetch", vi.fn());
