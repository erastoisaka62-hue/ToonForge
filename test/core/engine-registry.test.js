
/**
 * ToonForge — Engine Registry Tests
 *
 * Covers engine registration, discovery, execution,
 * duplicate protection, removal and running-engine safety.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EngineRegistry,
} from "../../src/core/engine-registry.js";

import {
  EngineBase,
  EngineError,
} from "../../src/core/engine-base.js";

class TestEngine extends EngineBase {
  constructor(options = {}) {
    super({
      id: options.id ?? "test-engine",
      name: options.name ?? "Test Engine",
      version: options.version ?? "1.0.0",
      description: options.description ?? "Registry test engine",
    });

    this.processCalls = [];
    this.processHandler = options.processHandler ?? null;
  }

  async process(input, context) {
    this.processCalls.push({ input, context });

    if (this.processHandler) {
      return this.processHandler(input, context);
    }

    return {
      received: input,
    };
  }
}

function createRegistry() {
  return new EngineRegistry();
}

describe("EngineRegistry", () => {
  describe("constructor and initial state", () => {
    it("should create an empty registry", () => {
      const registry = createRegistry();

      assert.equal(registry.size, 0);
      assert.deepEqual(registry.list(), []);
    });

    it("should expose an independent registry instance", () => {
      const first = createRegistry();
      const second = createRegistry();

      first.register(new TestEngine());

      assert.equal(first.size, 1);
      assert.equal(second.size, 0);
    });
  });

  describe("registration", () => {
    it("should register a valid EngineBase instance", () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      const info = registry.register(engine);

      assert.equal(registry.size, 1);
      assert.equal(info.id, engine.id);
      assert.equal(info.name, engine.name);
      assert.equal(info.status, "idle");
    });

    it("should return engine information rather than the engine instance", () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      const result = registry.register(engine);

      assert.notEqual(result, engine);
      assert.deepEqual(result, engine.getInfo());
    });

    it("should reject objects that do not extend EngineBase", () => {
      const registry = createRegistry();

      assert.throws(
        () => registry.register({
          id: "fake-engine",
          name: "Fake Engine",
          run() {},
        }),
        (error) =>
          error instanceof EngineError &&
          error.code === "INVALID_ENGINE_INSTANCE"
      );

      assert.equal(registry.size, 0);
    });

    it("should reject duplicate engine IDs", () => {
      const registry = createRegistry();

      registry.register(
        new TestEngine({ id: "character-engine" })
      );

      assert.throws(
        () => registry.register(
          new TestEngine({ id: "character-engine" })
        ),
        (error) =>
          error instanceof EngineError &&
          error.code === "ENGINE_ALREADY_REGISTERED"
      );

      assert.equal(registry.size, 1);
    });

    it("should allow different engines with different IDs", () => {
      const registry = createRegistry();

      registry.register(
        new TestEngine({ id: "character-engine" })
      );

      registry.register(
        new TestEngine({ id: "environment-engine" })
      );

      assert.equal(registry.size, 2);
    });
  });

  describe("engine discovery", () => {
    it("should retrieve a registered engine by ID", () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      assert.equal(registry.get(engine.id), engine);
    });

    it("should return null for an unknown engine ID", () => {
      const registry = createRegistry();

      assert.equal(registry.get("missing-engine"), null);
    });

    it("should identify registered engines", () => {
      const registry = createRegistry();

      registry.register(new TestEngine());

      assert.equal(registry.has("test-engine"), true);
      assert.equal(registry.has("missing-engine"), false);
    });

    it("should return the correct registry size", () => {
      const registry = createRegistry();

      assert.equal(registry.size, 0);

      registry.register(
        new TestEngine({ id: "engine-a" })
      );

      assert.equal(registry.size, 1);

      registry.register(
        new TestEngine({ id: "engine-b" })
      );

      assert.equal(registry.size, 2);
    });

    it("should list information about all registered engines", () => {
      const registry = createRegistry();

      registry.register(
        new TestEngine({
          id: "character-engine",
          name: "Character Engine",
        })
      );

      registry.register(
        new TestEngine({
          id: "camera-engine",
          name: "Camera Engine",
        })
      );

      const engines = registry.list();

      assert.equal(engines.length, 2);

      assert.deepEqual(
        engines.map((engine) => engine.id),
        ["character-engine", "camera-engine"]
      );

      assert.equal(
        engines[0].name,
        "Character Engine"
      );

      assert.equal(
        engines[1].name,
        "Camera Engine"
      );
    });

    it("should return independent information snapshots from list()", () => {
      const registry = createRegistry();

      registry.register(new TestEngine());

      const firstList = registry.list();
      firstList[0].name = "Modified Name";

      const secondList = registry.list();

      assert.equal(
        secondList[0].name,
        "Test Engine"
      );
    });
  });

  describe("engine execution", () => {
    it("should execute a registered engine", async () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      const result = await registry.run(
        engine.id,
        { sceneId: "scene-001" }
      );

      assert.equal(result.engineId, engine.id);
      assert.equal(result.status, "completed");

      assert.deepEqual(
        result.output,
        {
          received: {
            sceneId: "scene-001",
          },
        }
      );
    });

    it("should forward the execution context to the engine", async () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      const context = {
        executionId: "execution-001",
      };

      await registry.run(
        engine.id,
        { value: 10 },
        context
      );

      assert.equal(
        engine.processCalls[0].context,
        context
      );
    });

    it("should forward the input without modifying it", async () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      const input = {
        character: {
          id: "hero-001",
          attributes: ["brave", "curious"],
        },
      };

      await registry.run(engine.id, input);

      assert.equal(
        engine.processCalls[0].input,
        input
      );
    });

    it("should reject execution of an unknown engine", async () => {
      const registry = createRegistry();

      await assert.rejects(
        registry.run("missing-engine", {}),
        (error) =>
          error instanceof EngineError &&
          error.code === "ENGINE_NOT_FOUND"
      );
    });

    it("should preserve engine execution errors", async () => {
      const registry = createRegistry();

      const engine = new TestEngine({
        processHandler() {
          throw new Error("Processing failed.");
        },
      });

      registry.register(engine);

      await assert.rejects(
        registry.run(engine.id, {}),
        (error) =>
          error instanceof EngineError &&
          error.code === "ENGINE_EXECUTION_FAILED" &&
          error.message === "Processing failed."
      );

      assert.equal(engine.status, "failed");
    });
  });

  describe("unregistration", () => {
    it("should unregister an existing engine", () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      assert.equal(
        registry.unregister(engine.id),
        true
      );

      assert.equal(registry.has(engine.id), false);
      assert.equal(registry.size, 0);
    });

    it("should return false when unregistering an unknown engine", () => {
      const registry = createRegistry();

      assert.equal(
        registry.unregister("missing-engine"),
        false
      );
    });

    it("should reject unregistering an engine while it is running", async () => {
      const registry = createRegistry();

      let markStarted;
      let releaseExecution;

      const started = new Promise((resolve) => {
        markStarted = resolve;
      });

      const executionGate = new Promise((resolve) => {
        releaseExecution = resolve;
      });

      const engine = new TestEngine({
        processHandler: async () => {
          markStarted();
          await executionGate;

          return { completed: true };
        },
      });

      registry.register(engine);

      try {
        const execution = registry.run(
          engine.id,
          {}
        );

        await started;

        assert.equal(engine.status, "running");

        assert.throws(
          () => registry.unregister(engine.id),
          (error) =>
            error instanceof EngineError &&
            error.code === "ENGINE_IS_RUNNING"
        );

        assert.equal(registry.has(engine.id), true);

        releaseExecution();
        await execution;
      } finally {
        releaseExecution();
      }
    });

    it("should allow unregistering an engine after execution completes", async () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      await registry.run(engine.id, {});

      assert.equal(engine.status, "completed");
      assert.equal(registry.unregister(engine.id), true);
      assert.equal(registry.has(engine.id), false);
    });
  });

  describe("registry clearing", () => {
    it("should clear all registered engines", () => {
      const registry = createRegistry();

      registry.register(
        new TestEngine({ id: "engine-a" })
      );

      registry.register(
        new TestEngine({ id: "engine-b" })
      );

      assert.equal(registry.clear(), true);
      assert.equal(registry.size, 0);
      assert.deepEqual(registry.list(), []);
    });

    it("should allow clearing an empty registry", () => {
      const registry = createRegistry();

      assert.equal(registry.clear(), true);
      assert.equal(registry.size, 0);
    });

    it("should reject clearing while an engine is running", async () => {
      const registry = createRegistry();

      let markStarted;
      let releaseExecution;

      const started = new Promise((resolve) => {
        markStarted = resolve;
      });

      const executionGate = new Promise((resolve) => {
        releaseExecution = resolve;
      });

      const engine = new TestEngine({
        processHandler: async () => {
          markStarted();
          await executionGate;

          return { completed: true };
        },
      });

      registry.register(engine);

      try {
        const execution = registry.run(
          engine.id,
          {}
        );

        await started;

        assert.throws(
          () => registry.clear(),
          (error) =>
            error instanceof EngineError &&
            error.code === "REGISTRY_CLEAR_BLOCKED"
        );

        assert.equal(registry.has(engine.id), true);

        releaseExecution();
        await execution;
      } finally {
        releaseExecution();
      }
    });

    it("should allow clearing after all engines have stopped", async () => {
      const registry = createRegistry();
      const engine = new TestEngine();

      registry.register(engine);

      await registry.run(engine.id, {});

      assert.equal(registry.clear(), true);
      assert.equal(registry.size, 0);
    });
  });
});
           
