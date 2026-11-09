/**
 * ToonForge — Engine Event Bus Tests
 *
 * Covers listener lifecycle, dispatch ordering, error isolation,
 * asynchronous dispatch, AbortSignal cleanup and listener limits.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EngineEventBus } from "../../src/core/engine-events.js";

describe("EngineEventBus", () => {
  it("should subscribe, dispatch and unsubscribe listeners", () => {
    const bus = new EngineEventBus();
    let receivedEvent = null;

    const unsubscribe = bus.on("project:created", (event) => {
      receivedEvent = event;
    });

    const result = bus.emit("project:created", {
      projectId: "project-001",
    });

    assert.equal(result.delivered, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(receivedEvent.type, "project:created");
    assert.deepEqual(receivedEvent.payload, {
      projectId: "project-001",
    });
    assert.equal(bus.listenerCount("project:created"), 1);

    unsubscribe();

    assert.equal(bus.listenerCount("project:created"), 0);
    assert.equal(bus.emit("project:created").delivered, 0);
  });

  it("should invoke once-listeners only one time", () => {
    const bus = new EngineEventBus();
    let calls = 0;

    bus.once("render:completed", () => {
      calls += 1;
    });

    bus.emit("render:completed");
    bus.emit("render:completed");

    assert.equal(calls, 1);
    assert.equal(bus.listenerCount("render:completed"), 0);
  });

  it("should dispatch listeners by priority and preserve registration order for ties", () => {
    const bus = new EngineEventBus();
    const order = [];

    bus.on("engine:started", () => order.push("normal-first"));
    bus.on(
      "engine:started",
      () => order.push("high"),
      { priority: 10 }
    );
    bus.on("engine:started", () => order.push("normal-second"));
    bus.on(
      "engine:started",
      () => order.push("low"),
      { priority: -5 }
    );

    bus.emit("engine:started");

    assert.deepEqual(order, [
      "high",
      "normal-first",
      "normal-second",
      "low",
    ]);
  });

  it("should isolate synchronous listener errors and continue dispatch", () => {
    const bus = new EngineEventBus();
    const calls = [];

    bus.on("scene:ready", () => {
      throw new Error("Listener failure.");
    });
    bus.on("scene:ready", () => calls.push("second-listener"));

    const result = bus.emit("scene:ready");

    assert.equal(result.delivered, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(
      result.errors[0].error.message,
      "Listener failure."
    );
    assert.deepEqual(calls, ["second-listener"]);
  });

  it("should safely skip a listener removed during dispatch", () => {
    const bus = new EngineEventBus();
    const calls = [];
    let unsubscribeSecond;

    bus.on("timeline:updated", () => {
      calls.push("first");
      unsubscribeSecond();
    });

    unsubscribeSecond = bus.on("timeline:updated", () => {
      calls.push("second");
    });

    bus.emit("timeline:updated");

    assert.deepEqual(calls, ["first"]);
    assert.equal(bus.listenerCount("timeline:updated"), 1);
  });

  it("should await asynchronous listeners sequentially", async () => {
    const bus = new EngineEventBus();
    const order = [];

    bus.on("render:progress", async () => {
      order.push("first:start");
      await Promise.resolve();
      order.push("first:end");
    });

    bus.on("render:progress", async () => {
      order.push("second");
    });

    const result = await bus.emitAsync("render:progress");

    assert.equal(result.delivered, 2);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(order, [
      "first:start",
      "first:end",
      "second",
    ]);
  });

  it("should isolate asynchronous listener errors and continue dispatch", async () => {
    const bus = new EngineEventBus();
    const calls = [];

    bus.on("export:finished", async () => {
      throw new Error("Async listener failure.");
    });
    bus.on("export:finished", async () => {
      calls.push("continued");
    });

    const result = await bus.emitAsync("export:finished");

    assert.equal(result.delivered, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(
      result.errors[0].error.message,
      "Async listener failure."
    );
    assert.deepEqual(calls, ["continued"]);
  });

  it("should remove listeners when their AbortSignal is aborted", () => {
    const bus = new EngineEventBus();
    const controller = new AbortController();
    let calls = 0;

    const unsubscribe = bus.on(
      "job:cancelled",
      () => {
        calls += 1;
      },
      { signal: controller.signal }
    );

    assert.equal(bus.listenerCount("job:cancelled"), 1);

    controller.abort();

    assert.equal(bus.listenerCount("job:cancelled"), 0);
    assert.equal(bus.emit("job:cancelled").delivered, 0);

    // Calling the returned cleanup function after abort must be safe.
    unsubscribe();
    assert.equal(calls, 0);
  });

  it("should not register a listener when its signal is already aborted", () => {
    const bus = new EngineEventBus();
    const controller = new AbortController();
    controller.abort();

    const unsubscribe = bus.on(
      "asset:loaded",
      () => {},
      { signal: controller.signal }
    );

    assert.equal(bus.listenerCount("asset:loaded"), 0);
    assert.doesNotThrow(() => unsubscribe());
  });

  it("should remove matching handlers with off()", () => {
    const bus = new EngineEventBus();
    const handler = () => {};

    bus.on("audio:ready", handler);
    bus.on("audio:ready", handler);

    assert.equal(bus.off("audio:ready", handler), 2);
    assert.equal(bus.listenerCount("audio:ready"), 0);
  });

  it("should clear one event or all events", () => {
    const bus = new EngineEventBus();

    bus.on("event:one", () => {});
    bus.on("event:one", () => {});
    bus.on("event:two", () => {});

    assert.equal(bus.clear("event:one"), 2);
    assert.equal(bus.listenerCount("event:one"), 0);
    assert.equal(bus.listenerCount("event:two"), 1);

    assert.equal(bus.clear(), 1);
    assert.equal(bus.eventCount, 0);
  });

  it("should enforce the configured listener limit", () => {
    const bus = new EngineEventBus({ maxListeners: 1 });

    bus.on("limited:event", () => {});

    assert.throws(
      () => bus.on("limited:event", () => {}),
      RangeError
    );
  });

  it("should reject invalid event names, handlers and listener options", () => {
    const bus = new EngineEventBus();

    assert.throws(() => bus.on("", () => {}), TypeError);
    assert.throws(() => bus.on(" event ", () => {}), TypeError);
    assert.throws(() => bus.on("valid:event", null), TypeError);
    assert.throws(
      () => bus.on("valid:event", () => {}, { priority: NaN }),
      TypeError
    );
    assert.throws(
      () => bus.on("valid:event", () => {}, { unsupported: true }),
      TypeError
    );
  });
});
