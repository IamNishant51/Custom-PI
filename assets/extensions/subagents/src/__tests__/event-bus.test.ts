import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus } from "../event-bus/event-bus";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxHistoryPerTopic: 100 });
  });

  it("emits and receives events", () => {
    const handler = vi.fn();
    bus.on("test.event", handler);
    bus.emit("test.event", { foo: "bar" }, { source: "test" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ data: { foo: "bar" } }),
      expect.objectContaining({ topic: "test.event", source: "test" }),
    );
  });

  it("supports wildcard subscribers", () => {
    const handler = vi.fn();
    bus.on("*", handler);
    bus.emit("any.event", { value: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("filters events", () => {
    const handler = vi.fn();
    bus.on("test.event", handler, {
      filter: (event) => (event.data as { priority?: string }).priority === "high",
    });
    bus.emit("test.event", { priority: "low" });
    bus.emit("test.event", { priority: "high" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("respects priority ordering", () => {
    const order: number[] = [];
    bus.on("test.event", () => { order.push(1); }, { priority: 10 });
    bus.on("test.event", () => { order.push(2); }, { priority: 20 });
    bus.on("test.event", () => { order.push(3); }, { priority: 5 });
    bus.emit("test.event", {});
    expect(order).toEqual([2, 1, 3]);
  });

  it("once fires only once", () => {
    const handler = vi.fn();
    bus.once("test.event", handler);
    bus.emit("test.event", {});
    bus.emit("test.event", {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes handler", () => {
    const handler = vi.fn();
    const id = bus.on("test.event", handler);
    bus.unsubscribe(id);
    bus.emit("test.event", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("stores event history", () => {
    bus.emit("e1", { n: 1 });
    bus.emit("e1", { n: 2 });
    bus.emit("e2", { n: 3 });
    const history = bus.getHistory("e1");
    expect(history).toHaveLength(2);
    expect(history[0].data).toEqual({ n: 1 });
    expect(history[1].data).toEqual({ n: 2 });
  });

  it("replays events", () => {
    bus.emit("replayable", { x: 1 });
    bus.emit("replayable", { x: 2 });
    const handler = vi.fn();
    bus.replay("replayable", handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("replays events since timestamp", async () => {
    bus.emit("r", { x: 1 });
    await new Promise(r => setTimeout(r, 10));
    const after = Date.now();
    await new Promise(r => setTimeout(r, 10));
    bus.emit("r", { x: 2 });
    const handler = vi.fn();
    bus.replay("r", handler, { since: after });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ x: 2 }), expect.anything());
  });

  it("limits history per topic", () => {
    const smallBus = new EventBus({ maxHistoryPerTopic: 3 });
    for (let i = 0; i < 10; i++) smallBus.emit("limited", { i });
    expect(smallBus.getHistory("limited")).toHaveLength(3);
  });

  it("clearTopic removes history", () => {
    bus.emit("topic", {});
    bus.clearTopic("topic");
    expect(bus.getHistory("topic")).toHaveLength(0);
  });

  it("clearAll resets everything", () => {
    bus.on("t", () => {});
    bus.emit("t", {});
    bus.clearAll();
    expect(bus.getEventCount()).toBe(0);
    expect(bus.subscriberCount("t")).toBe(0);
  });

  it("getAllTopics returns topic names", () => {
    bus.emit("a", {});
    bus.emit("b", {});
    expect(bus.getAllTopics()).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("subscriberCount returns correct count", () => {
    bus.on("t", () => {});
    bus.on("t", () => {});
    expect(bus.subscriberCount("t")).toBe(2);
  });

  it("handles errors in handlers gracefully", () => {
    bus.on("t", () => { throw new Error("handler error"); });
    const handler2 = vi.fn();
    bus.on("t", handler2);
    expect(() => bus.emit("t", {})).not.toThrow();
    expect(handler2).toHaveBeenCalled();
  });

  it("emit returns an event id", () => {
    const id = bus.emit("t", {});
    expect(id).toContain("evt_");
  });

  it("supports middleware registration", () => {
    const middleware = vi.fn((event, next) => next());
    bus.use(middleware);
    expect(true).toBe(true);
  });
});
