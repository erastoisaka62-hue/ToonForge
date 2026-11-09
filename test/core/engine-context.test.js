/**
 * ToonForge — Engine Context Tests
 *
 * Covers execution metadata, shared data, cancellation,
 * progress reporting, event history and log management.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EngineContext,
} from "../../src/core/engine-context.js";

import {
  EngineError,
} from "../../src/core/engine-base.js";

describe("EngineContext", () => {
  it("should create a context with valid default values", () => {
    const context = new EngineContext();

    assert.ok(context.executionId.startsWith("exec-"));
    assert.equal(context.parentExecutionId, null);
    assert.equal(context.project, null);
    assert.equal(context.scene, null);
    assert.deepEqual(context.metadata, {});
    assert.equal(context.isAborted, false);
    assert.equal(context.progress.value, 0);
    assert.equal(context.progress.message, "");
    assert.deepEqual(context.getEvents(), []);
  });

  it("should preserve execution and project metadata", () => {
    const context = new EngineContext({
      executionId: "execution-001",
      parentExecutionId: "execution-parent",
      project: {
        id: "project-001",
        name: "My Cartoon",
      },
      scene: {
        id: "scene-001",
        name: "Opening Scene",
      },
      metadata: {
        quality: "high",
        version: 1,
      },
    });

    assert.equal(context.executionId, "execution-001");
    assert.equal(
      context.parentExecutionId,
      "execution-parent"
    );

    assert.equal(context.project.id, "project-001");
    assert.equal(context.scene.id, "scene-001");

    const info = context.getInfo();

    assert.equal(info.projectId, "project-001");
    assert.equal(info.sceneId, "scene-001");
    assert.equal(info.metadata.quality, "high");
  });

  it("should reject invalid execution configuration", () => {
    assert.throws(
      () => new EngineContext({
        executionId: " ",
      }),
      TypeError
    );

    assert.throws(
      () => new EngineContext({
        parentExecutionId: "",
      }),
      TypeError
    );

    assert.throws(
      () => new EngineContext({
        project: [],
      }),
      TypeError
    );

    assert.throws(
      () => new EngineContext({
        scene: "invalid",
      }),
      TypeError
    );

    assert.throws(
      () => new EngineContext({
        metadata: [],
      }),
      TypeError
    );

    assert.throws(
      () => new EngineContext({
        maxEventEntries: 0,
      }),
      RangeError
    );
  });

  it("should create independent execution identifiers", () => {
    const first = new EngineContext();
    const second = new EngineContext();

    assert.notEqual(first.executionId, second.executionId);
  });

  it("should store and retrieve data by namespace and key", () => {
    const context = new EngineContext();

    const asset = {
      type: "character",
      name: "Hero",
    };

    context.setData("characters", "hero", asset);

    assert.equal(
      context.getData("characters", "hero"),
      asset
    );

    assert.equal(
      context.hasData("characters", "hero"),
      true
    );

    assert.equal(
      context.getData("characters", "missing", "fallback"),
      "fallback"
    );

    assert.equal(
      context.hasData("characters", "missing"),
      false
    );
  });

  it("should keep identical keys isolated between namespaces", () => {
    const context = new EngineContext();

    context.setData("characters", "main", "Hero");
    context.setData("environments", "main", "Village");

    assert.equal(
      context.getData("characters", "main"),
      "Hero"
    );

    assert.equal(
      context.getData("environments", "main"),
      "Village"
    );
  });

  it("should delete data and clean up empty namespaces", () => {
    const context = new EngineContext();

    context.setData("render", "frame", 100);

    assert.equal(
      context.deleteData("render", "frame"),
      true
    );

    assert.equal(
      context.hasData("render", "frame"),
      false
    );

    assert.equal(
      context.getNamespaceData("render").size,
      0
    );

    assert.equal(
      context.deleteData("render", "missing"),
      false
    );
  });

  it("should return a defensive copy of namespace data", () => {
    const context = new EngineContext();

    context.setData("assets", "character", "Hero");

    const copiedData = context.getNamespaceData("assets");

    copiedData.set("character", "Modified Hero");
    copiedData.set("new", "Unexpected");

    assert.equal(
      context.getData("assets", "character"),
      "Hero"
    );

    assert.equal(
      context.hasData("assets", "new"),
      false
    );
  });

  it("should clear one namespace or all shared data", () => {
    const context = new EngineContext();

    context.setData("characters", "hero", "Hero");
    context.setData("characters", "villain", "Villain");
    context.setData("audio", "music", "Background Music");

    assert.equal(
      context.clearData("characters"),
      2
    );

    assert.equal(
      context.hasData("characters", "hero"),
      false
    );

    assert.equal(
      context.getData("audio", "music"),
      "Background Music"
    );

    assert.equal(context.clearData(), 1);
    assert.equal(context.getData("audio", "music"), undefined);
    assert.equal(context.clearData(), 0);
  });

  it("should reject invalid shared data namespace and key values", () => {
    const context = new EngineContext();

    assert.throws(
      () => context.setData("", "key", "value"),
      TypeError
    );

    assert.throws(
      () => context.setData("namespace", " ", "value"),
      TypeError
    );

    assert.throws(
      () => context.getData("namespace", ""),
      TypeError
    );

    assert.throws(
      () => context.hasData("", "key"),
      TypeError
    );

    assert.throws(
      () => context.deleteData("namespace", ""),
      TypeError
    );
  });

  it("should record structured logs", () => {
    const context = new EngineContext();

    const event = context.log(
      "info",
      "Character created.",
      {
        characterId: "hero-001",
      }
    );

    assert.equal(event.type, "log");
    assert.equal(event.level, "info");
    assert.equal(event.message, "Character created.");
    assert.equal(event.details.characterId, "hero-001");

    const logs = context.getLogs();

    assert.equal(logs.length, 1);
    assert.equal(logs[0].message, "Character created.");
  });

  it("should reject invalid log levels and messages", () => {
    const context = new EngineContext();

    assert.throws(
      () => context.log("trace", "Invalid level"),
      TypeError
    );

    assert.throws(
      () => context.log("info", ""),
      TypeError
    );

    assert.throws(
      () => context.log("info", "   "),
      TypeError
    );
  });

  it("should report progress and retain the latest progress snapshot", () => {
    const context = new EngineContext();

    const progress = context.reportProgress(
      45,
      "Generating character animation"
    );

    assert.equal(progress.value, 45);
    assert.equal(
      progress.message,
      "Generating character animation"
    );

    assert.equal(context.progress.value, 45);

    assert.equal(
      context.getEvents({ type: "progress" }).length,
      1
    );
  });

  it("should reject progress outside the valid range", () => {
    const context = new EngineContext();

    assert.throws(
      () => context.reportProgress(-1),
      RangeError
    );

    assert.throws(
      () => context.reportProgress(101),
      RangeError
    );

    assert.throws(
      () => context.reportProgress(NaN),
      RangeError
    );

    assert.throws(
      () => context.reportProgress(50, 123),
      TypeError
    );
  });

  it("should filter events by type and sequence", () => {
    const context = new EngineContext();

    const first = context.log("info", "First log");
    const second = context.reportProgress(25, "Starting");
    const third = context.log("warn", "Second log");

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(third.sequence, 3);

    assert.equal(
      context.getEvents({ type: "log" }).length,
      2
    );

    const recent = context.getEvents({
      sinceSequence: 1,
    });

    assert.equal(recent.length, 2);
    assert.equal(recent[0].sequence, 2);
    assert.equal(recent[1].sequence, 3);
  });

  it("should limit retained event history", () => {
    const context = new EngineContext({
      maxEventEntries: 2,
    });

    context.log("info", "First");
    context.log("info", "Second");
    context.log("info", "Third");

    const events = context.getEvents();

    assert.equal(events.length, 2);
    assert.equal(events[0].sequence, 2);
    assert.equal(events[1].sequence, 3);
  });

  it("should clear events without resetting sequence identifiers", () => {
    const context = new EngineContext();

    context.log("info", "First");
    context.log("info", "Second");

    assert.equal(context.clearEvents(), 2);
    assert.deepEqual(context.getEvents(), []);

    const next = context.log("info", "Third");

    assert.equal(next.sequence, 3);
  });

  it("should reject invalid event filtering options", () => {
    const context = new EngineContext();

    assert.throws(
      () => context.getEvents({
        sinceSequence: -1,
      }),
      RangeError
    );

    assert.throws(
      () => context.getEvents({
        sinceSequence: 1.5,
      }),
      RangeError
    );

    assert.throws(
      () => context.getEvents({
        type: 123,
      }),
      TypeError
    );
  });

  it("should support cancellation through AbortSignal", () => {
    const controller = new AbortController();

    const context = new EngineContext({
      signal: controller.signal,
    });

    assert.equal(context.isAborted, false);

    controller.abort("User cancelled the render.");

    assert.equal(context.isAborted, true);

    assert.throws(
      () => context.throwIfAborted(),
      (error) => {
        assert.ok(error instanceof EngineError);
        assert.equal(error.code, "EXECUTION_ABORTED");
        assert.equal(
          error.message,
          "User cancelled the render."
        );

        return true;
      }
    );
  });

  it("should support Error objects as cancellation reasons", () => {
    const controller = new AbortController();
    const reason = new Error("Rendering interrupted.");

    const context = new EngineContext({
      signal: controller.signal,
    });

    controller.abort(reason);

    assert.throws(
      () => context.throwIfAborted(),
      (error) => {
        assert.equal(error.code, "EXECUTION_ABORTED");
        assert.equal(error.message, reason.message);
        assert.equal(error.cause, reason);

        return true;
      }
    );
  });

  it("should return normally when execution has not been cancelled", () => {
    const context = new EngineContext();

    assert.equal(context.throwIfAborted(), undefined);
  });

  it("should expose a serializable execution summary", () => {
    const context = new EngineContext({
      executionId: "execution-summary",
      project: {
        id: "project-summary",
      },
      scene: {
        id: "scene-summary",
      },
      metadata: {
        quality: "medium",
      },
    });

    context.reportProgress(75, "Rendering");

    const info = context.getInfo();

    assert.equal(info.executionId, "execution-summary");
    assert.equal(info.projectId, "project-summary");
    assert.equal(info.sceneId, "scene-summary");
    assert.equal(info.progress.value, 75);
    assert.equal(info.metadata.quality, "medium");

    assert.doesNotThrow(() => JSON.stringify(info));
  });
});
