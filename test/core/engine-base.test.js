/**
 * ToonForge — Engine Base Tests
 *
 * Tests the shared engine lifecycle, validation,
 * error handling, cancellation and lifecycle events.
 */

import {
  afterEach,
  describe,
  it,
} from "node:test";

import assert from "node:assert/strict";

import {
  EngineBase,
  EngineError,
  ENGINE_STATES,
} from "../../src/core/engine-base.js";

import { engineEvents } from "../../src/core/engine-events.js";

afterEach(() => {
  engineEvents.clear();
});

class EchoEngine extends EngineBase {
  async process(input) {
    return {
      received: input,
    };
  }
}

describe("EngineBase", () => {
  it("should initialize with the correct default state", () => {
    const engine = new EchoEngine({
      id: "test.echo",
      name: "Echo Engine",
    });

    assert.equal(engine.status, ENGINE_STATES.IDLE);
    assert.equal(engine.lastRun, null);
    assert.equal(engine.getInfo().id, "test.echo");
  });

  it("should reject invalid engine configuration", () => {
    assert.throws(
      () => new EchoEngine({
        id: "",
        name: "Invalid Engine",
      }),
      TypeError
    );

    assert.throws(
      () => new EchoEngine({
        id: "test.invalid",
        name: "",
      }),
      TypeError
    );
  });

  it("should execute successfully and return its output", async () => {
    const engine = new EchoEngine({
      id: "test.echo",
      name: "Echo Engine",
    });

    const result = await engine.run({
      message: "Hello ToonForge",
    });

    assert.equal(
      result.status,
      ENGINE_STATES.COMPLETED
    );

    assert.deepEqual(result.output, {
      received: {
        message: "Hello ToonForge",
      },
    });

    assert.equal(
      engine.status,
      ENGINE_STATES.COMPLETED
    );

    assert.ok(engine.lastRun.completedAt);
    assert.ok(engine.lastRun.durationMs >= 0);
  });

  it("should publish lifecycle events", async () => {
    const engine = new EchoEngine({
      id: "test.events",
      name: "Event Test Engine",
    });

    const receivedEvents = [];

    const unsubscribeStarted = engineEvents.on(
      "engine:started",
      (event) => receivedEvents.push(event)
    );

    const unsubscribeCompleted = engineEvents.on(
      "engine:completed",
      (event) => receivedEvents.push(event)
    );

    try {
      await engine.run({ value: 10 });

      assert.equal(receivedEvents.length, 2);

      assert.equal(
        receivedEvents[0].payload.engineId,
        "test.events"
      );

      assert.equal(
        receivedEvents[1].payload.engineId,
        "test.events"
      );
    } finally {
      unsubscribeStarted();
      unsubscribeCompleted();
    }
  });

  it("should reject invalid input validation", async () => {
    class InvalidEngine extends EngineBase {
      validate() {
        return {
          valid: false,
          errors: [
            {
              field: "script",
              message: "Script is required.",
            },
          ],
        };
      }

      async process() {
        throw new Error(
          "Process should not execute."
        );
      }
    }

    const engine = new InvalidEngine({
      id: "test.invalid-input",
      name: "Invalid Input Engine",
    });

    await assert.rejects(
      engine.run({}),
      (error) => {
        assert.ok(error instanceof EngineError);

        assert.equal(
          error.code,
          "INPUT_VALIDATION_FAILED"
        );

        return true;
      }
    );

    assert.equal(
      engine.status,
      ENGINE_STATES.FAILED
    );
  });

  it("should normalize processing errors", async () => {
    class BrokenEngine extends EngineBase {
      async process() {
        throw new Error("Rendering failed.");
      }
    }

    const engine = new BrokenEngine({
      id: "test.broken",
      name: "Broken Engine",
    });

    await assert.rejects(
      engine.run({}),
      (error) => {
        assert.equal(
          error.code,
          "ENGINE_EXECUTION_FAILED"
        );

        assert.equal(
          error.engineId,
          "test.broken"
        );

        return true;
      }
    );

    assert.equal(
      engine.status,
      ENGINE_STATES.FAILED
    );

    assert.equal(
      engine.lastRun.error.code,
      "ENGINE_EXECUTION_FAILED"
    );
  });

  it("should cancel before processing when the signal is aborted", async () => {
    const controller = new AbortController();

    controller.abort("User cancelled.");

    let processCalled = false;

    class CancellationEngine extends EngineBase {
      async process() {
        processCalled = true;
        return "unexpected";
      }
    }

    const engine = new CancellationEngine({
      id: "test.cancel-before",
      name: "Cancellation Engine",
    });

    await assert.rejects(
      engine.run({}, {
        signal: controller.signal,
      }),
      (error) => {
        assert.equal(
          error.code,
          "EXECUTION_ABORTED"
        );

        return true;
      }
    );

    assert.equal(processCalled, false);

    assert.equal(
      engine.status,
      ENGINE_STATES.CANCELLED
    );
  });

  it("should cancel after processing if cancellation occurs during execution", async () => {
    const controller = new AbortController();

    let markStarted;

    const started = new Promise((resolve) => {
      markStarted = resolve;
    });

    let finishProcessing;

    const processing = new Promise((resolve) => {
      finishProcessing = resolve;
    });

    class SlowEngine extends EngineBase {
      async process() {
        markStarted();
        return processing;
      }
    }

    const engine = new SlowEngine({
      id: "test.cancel-during",
      name: "Slow Engine",
    });

    const execution = engine.run({}, {
      signal: controller.signal,
    });

    await started;

    controller.abort("Stopped during processing.");

    finishProcessing("finished");

    await assert.rejects(
      execution,
      (error) => {
        assert.equal(
          error.code,
          "EXECUTION_ABORTED"
        );

        return true;
      }
    );

    assert.equal(
      engine.status,
      ENGINE_STATES.CANCELLED
    );
  });

  it("should prevent resetting an engine while it is running", async () => {
    let markStarted;
    let finishProcessing;

    const started = new Promise((resolve) => {
      markStarted = resolve;
    });

    const processing = new Promise((resolve) => {
      finishProcessing = resolve;
    });

    class SlowEngine extends EngineBase {
      async process() {
        markStarted();
        return processing;
      }
    }

    const engine = new SlowEngine({
      id: "test.running",
      name: "Running Engine",
    });

    const execution = engine.run({});

    await started;

    assert.throws(
      () => engine.reset(),
      (error) => {
        assert.equal(
          error.code,
          "ENGINE_RESET_BLOCKED"
        );

        return true;
      }
    );

    finishProcessing("done");

    await execution;

    assert.equal(
      engine.reset().status,
      ENGINE_STATES.IDLE
    );
  });
});
