
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EngineOrchestrator } from "../../src/core/engine-orchestrator.js";
import { EngineContext } from "../../src/core/engine-context.js";
import { EngineError } from "../../src/core/engine-base.js";

function createHarness({
  engines = ["engine-a", "engine-b", "engine-c"],
  run,
  validateEngine,
  maxSteps = 100,
} = {}) {
  const calls = [];

  const engineMap = new Map(
    engines.map((id) => [
      id,
      { id, name: id, status: "idle" },
    ])
  );

  const registry = {
    get(id) {
      return engineMap.get(id) ?? null;
    },

    async run(engineId, input, context) {
      calls.push({ engineId, input, context });

      if (run) {
        return run(engineId, input, context);
      }

      return { output: input };
    },
  };

  const validator = {
    validateEngine(engine) {
      if (validateEngine) {
        return validateEngine(engine);
      }

      return { valid: true, errors: [] };
    },
  };

  return {
    orchestrator: new EngineOrchestrator({
      registry,
      validator,
      maxSteps,
    }),
    registry,
    validator,
    calls,
  };
}

function step(id, engineId, input = {}) {
  return { id, engineId, input };
}

describe("EngineOrchestrator", () => {
  describe("constructor", () => {
    it("accepts valid dependencies", () => {
      const harness = createHarness();
      assert.ok(harness.orchestrator instanceof EngineOrchestrator);
    });

    it("rejects an invalid registry", () => {
      assert.throws(
        () => new EngineOrchestrator({ registry: {} }),
        TypeError
      );
    });

    it("rejects an invalid validator", () => {
      assert.throws(
        () => new EngineOrchestrator({
          registry: { get() {}, run() {} },
          validator: {},
        }),
        TypeError
      );
    });

    it("rejects invalid maximum step limits", () => {
      const harness = createHarness();

      for (const maxSteps of [0, -1, 1.5, 10001]) {
        assert.throws(
          () => new EngineOrchestrator({
            registry: harness.registry,
            validator: harness.validator,
            maxSteps,
          }),
          RangeError
        );
      }
    });
  });

  describe("pipeline validation", () => {
    it("rejects a non-object plan", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run(null),
        (error) => error.code === "INVALID_PIPELINE_PLAN"
      );
    });

    it("rejects missing steps", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({}),
        (error) => error.code === "INVALID_PIPELINE_STEPS"
      );
    });

    it("rejects an empty pipeline", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({ steps: [] }),
        (error) => error.code === "EMPTY_PIPELINE"
      );
    });

    it("rejects unknown plan options", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [step("one", "engine-a")],
          unexpected: true,
        }),
        (error) => error.code === "UNKNOWN_PIPELINE_OPTION"
      );
    });

    it("rejects duplicate step IDs", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [
            step("duplicate", "engine-a"),
            step("duplicate", "engine-b"),
          ],
        }),
        (error) => error.code === "DUPLICATE_STEP_ID"
      );
    });

    it("requires exactly one input source per step", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [{
            id: "one",
            engineId: "engine-a",
            input: {},
            inputFactory: () => ({}),
          }],
        }),
        (error) => error.code === "INVALID_STEP_INPUT"
      );

      await assert.rejects(
        orchestrator.run({
          steps: [{
            id: "one",
            engineId: "engine-a",
          }],
        }),
        (error) => error.code === "INVALID_STEP_INPUT"
      );
    });

    it("rejects a non-function inputFactory", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [{
            id: "one",
            engineId: "engine-a",
            inputFactory: "invalid",
          }],
        }),
        (error) => error.code === "INVALID_INPUT_FACTORY"
      );
    });

    it("enforces the maximum number of steps", async () => {
      const { orchestrator } = createHarness({ maxSteps: 1 });

      await assert.rejects(
        orchestrator.run({
          steps: [
            step("one", "engine-a"),
            step("two", "engine-b"),
          ],
        }),
        (error) => error.code === "PIPELINE_STEP_LIMIT"
      );
    });

    it("rejects sparse step arrays", async () => {
      const { orchestrator } = createHarness();
      const steps = new Array(1);

      await assert.rejects(
        orchestrator.run({ steps }),
        (error) => error.code === "INVALID_PIPELINE_STEP"
      );
    });

    it("rejects accessor properties without executing getters", async () => {
      const { orchestrator } = createHarness();
      let getterExecuted = false;

      const unsafeStep = {
        id: "one",
        engineId: "engine-a",
      };

      Object.defineProperty(unsafeStep, "input", {
        enumerable: true,
        get() {
          getterExecuted = true;
          throw new Error("Getter must not execute.");
        },
      });

      await assert.rejects(
        orchestrator.run({ steps: [unsafeStep] }),
        (error) =>
          error instanceof TypeError &&
          error.message.includes("Accessor properties are not allowed")
      );

      assert.equal(getterExecuted, false);
    });
  });

  describe("engine preflight", () => {
    it("rejects an engine that is not registered", async () => {
      const harness = createHarness();

      await assert.rejects(
        harness.orchestrator.run({
          steps: [step("one", "missing-engine")],
        }),
        (error) => error.code === "ENGINE_NOT_FOUND"
      );

      assert.equal(harness.calls.length, 0);
    });

    it("validates each unique engine before execution", async () => {
      const validated = [];

      const harness = createHarness({
        validateEngine(engine) {
          validated.push(engine.id);
          return { valid: true, errors: [] };
        },
      });

      const result = await harness.orchestrator.run({
        steps: [
          step("one", "engine-a"),
          step("two", "engine-b"),
          step("three", "engine-a"),
        ],
      });

      assert.deepEqual(validated, ["engine-a", "engine-b"]);
      assert.equal(result.status, "completed");
    });

    it("stops when engine validation fails", async () => {
      const harness = createHarness({
        validateEngine() {
          return {
            valid: false,
            errors: [{ message: "Invalid engine." }],
          };
        },
      });

      await assert.rejects(
        harness.orchestrator.run({
          steps: [step("one", "engine-a")],
        }),
        (error) => error.code === "ENGINE_VALIDATION_FAILED"
      );

      assert.equal(harness.calls.length, 0);
    });

    it("wraps unexpected preflight errors", async () => {
      const harness = createHarness({
        validateEngine() {
          throw new Error("Validation crashed.");
        },
      });

      await assert.rejects(
        harness.orchestrator.run({
          steps: [step("one", "engine-a")],
        }),
        (error) => error.code === "ENGINE_PREFLIGHT_FAILED"
      );

      assert.equal(harness.calls.length, 0);
    });
  });

  describe("sequential execution", () => {
    it("executes engines in the correct order", async () => {
      const harness = createHarness();

      const result = await harness.orchestrator.run({
        steps: [
          step("one", "engine-a", { value: 1 }),
          step("two", "engine-b", { value: 2 }),
          step("three", "engine-c", { value: 3 }),
        ],
      });

      assert.deepEqual(
        harness.calls.map((call) => call.engineId),
        ["engine-a", "engine-b", "engine-c"]
      );

      assert.equal(result.status, "completed");
      assert.equal(result.summary.completed, 3);
      assert.equal(result.summary.failed, 0);
    });

    it("passes fixed input to the engine", async () => {
      const harness = createHarness();

      await harness.orchestrator.run({
        steps: [
          step("character", "engine-a", {
            characterId: "hero-001",
          }),
        ],
      });

      assert.deepEqual(harness.calls[0].input, {
        characterId: "hero-001",
      });
    });

    it("shares one context across all engines", async () => {
      const harness = createHarness();

      await harness.orchestrator.run({
        steps: [
          step("one", "engine-a"),
          step("two", "engine-b"),
        ],
      });

      assert.ok(harness.calls[0].context instanceof EngineContext);
      assert.equal(
        harness.calls[0].context,
        harness.calls[1].context
      );
    });

    it("stores successful step results", async () => {
      const harness = createHarness({
        run: async (engineId, input) => ({
          engineId,
          output: input.value * 2,
        }),
      });

      const result = await harness.orchestrator.run({
        steps: [
          step("one", "engine-a", { value: 5 }),
        ],
      });

      assert.equal(result.steps[0].status, "completed");
      assert.deepEqual(result.steps[0].result, {
        engineId: "engine-a",
        output: 10,
      });
    });

    it("provides the previous result to inputFactory", async () => {
      const harness = createHarness({
        run: async (engineId, input) => ({
          output: input.value * 2,
        }),
      });

      let previous;

      const result = await harness.orchestrator.run({
        steps: [
          step("first", "engine-a", { value: 5 }),
          {
            id: "second",
            engineId: "engine-b",
            inputFactory: ({ previousResult }) => {
              previous = previousResult;
              return { value: previousResult.result.output };
            },
          },
        ],
      });

      assert.equal(previous.result.output, 10);
      assert.deepEqual(harness.calls[1].input, { value: 10 });
      assert.equal(result.status, "completed");
    });

    it("provides earlier results through a Map", async () => {
      const harness = createHarness();
      let receivedResults;

      await harness.orchestrator.run({
        steps: [
          step("first", "engine-a", { value: 1 }),
          step("second", "engine-b", { value: 2 }),
          {
            id: "third",
            engineId: "engine-c",
            inputFactory: ({ results }) => {
              receivedResults = results;

              return {
                firstOutput: results.get("first").result.output.value,
                secondOutput: results.get("second").result.output.value,
              };
            },
          },
        ],
      });

      assert.equal(receivedResults.size, 2);
      assert.deepEqual(harness.calls[2].input, {
        firstOutput: 1,
        secondOutput: 2,
      });
    });

    it("allows inputFactory to access the shared context", async () => {
      const harness = createHarness();
      let factoryContext;

      await harness.orchestrator.run({
        steps: [{
          id: "one",
          engineId: "engine-a",
          inputFactory: ({ context }) => {
            factoryContext = context;
            return { executionId: context.executionId };
          },
        }],
      });

      assert.ok(factoryContext instanceof EngineContext);
      assert.equal(
        harness.calls[0].input.executionId,
        factoryContext.executionId
      );
    });

    it("provides frozen step information to inputFactory", async () => {
      const harness = createHarness();
      let receivedStep;

      await harness.orchestrator.run({
        steps: [{
          id: "one",
          engineId: "engine-a",
          inputFactory: ({ step: currentStep }) => {
            receivedStep = currentStep;
            return {};
          },
        }],
      });

      assert.deepEqual(receivedStep, {
        id: "one",
        engineId: "engine-a",
      });

      assert.equal(Object.isFrozen(receivedStep), true);
    });
  });

  describe("failure handling", () => {
    it("skips remaining steps when failFast is enabled", async () => {
      const harness = createHarness({
        run: async (engineId) => {
          if (engineId === "engine-a") {
            throw new Error("Character generation failed.");
          }

          return { output: "ok" };
        },
      });

      const result = await harness.orchestrator.run({
        steps: [
          step("first", "engine-a"),
          step("second", "engine-b"),
        ],
      });

      assert.equal(result.status, "failed");
      assert.equal(result.summary.failed, 1);
      assert.equal(result.summary.skipped, 1);
      assert.equal(harness.calls.length, 1);
      assert.equal(result.steps[1].status, "skipped");
    });

    it("continues after a failure when failFast is false", async () => {
      const harness = createHarness({
        run: async (engineId) => {
          if (engineId === "engine-a") {
            throw new Error("Temporary failure.");
          }

          return { output: "success" };
        },
      });

      const result = await harness.orchestrator.run({
        failFast: false,
        steps: [
          step("first", "engine-a"),
          step("second", "engine-b"),
        ],
      });

      assert.equal(result.status, "completed_with_errors");
      assert.equal(result.summary.failed, 1);
      assert.equal(result.summary.completed, 1);
      assert.equal(harness.calls.length, 2);
    });

    it("normalizes ordinary execution errors", async () => {
      const harness = createHarness({
        run: async () => {
          throw new Error("Rendering failed.");
        },
      });

      const result = await harness.orchestrator.run({
        steps: [step("render", "engine-a")],
      });

      assert.equal(result.steps[0].status, "failed");
      assert.equal(
        result.steps[0].error.code,
        "PIPELINE_STEP_FAILED"
      );
      assert.equal(
        result.steps[0].error.message,
        "Rendering failed."
      );
    });

    it("preserves EngineError codes", async () => {
      const harness = createHarness({
        run: async () => {
          throw new EngineError("Invalid scene.", {
            code: "SCENE_INVALID",
          });
        },
      });

      const result = await harness.orchestrator.run({
        steps: [step("scene", "engine-a")],
      });

      assert.equal(
        result.steps[0].error.code,
        "SCENE_INVALID"
      );
    });

    it("reports failed when all steps fail", async () => {
      const harness = createHarness({
        run: async () => {
          throw new Error("Failed.");
        },
      });

      const result = await harness.orchestrator.run({
        failFast: false,
        steps: [
          step("first", "engine-a"),
          step("second", "engine-b"),
        ],
      });

      assert.equal(result.status, "failed");
      assert.equal(result.summary.failed, 2);
      assert.equal(result.summary.completed, 0);
    });
  });

  describe("cancellation", () => {
    it("cancels before starting an engine when already aborted", async () => {
      const harness = createHarness();
      const controller = new AbortController();

      controller.abort(new Error("User cancelled."));

      const result = await harness.orchestrator.run({
        signal: controller.signal,
        steps: [step("one", "engine-a")],
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.summary.cancelled, 1);
      assert.equal(harness.calls.length, 0);
    });

    it("stops when inputFactory cancels execution", async () => {
      const harness = createHarness();
      const controller = new AbortController();

      const result = await harness.orchestrator.run({
        signal: controller.signal,
        steps: [
          {
            id: "one",
            engineId: "engine-a",
            inputFactory: () => {
              controller.abort(new Error("Cancelled during preparation."));
              return {};
            },
          },
          step("two", "engine-b"),
        ],
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.summary.cancelled, 1);
      assert.equal(result.summary.skipped, 1);
      assert.equal(harness.calls.length, 0);
    });
  });

  describe("context and metadata", () => {
    it("uses a supplied EngineContext", async () => {
      const harness = createHarness();

      const context = new EngineContext({
        executionId: "test-execution-001",
      });

      const result = await harness.orchestrator.run({
        context,
        steps: [step("one", "engine-a")],
      });

      assert.equal(result.executionId, "test-execution-001");
      assert.equal(result.context.executionId, "test-execution-001");
    });

    it("rejects a non-EngineContext context", async () => {
      const harness = createHarness();

      await assert.rejects(
        harness.orchestrator.run({
          context: {},
          steps: [step("one", "engine-a")],
        }),
        (error) => error.code === "INVALID_ENGINE_CONTEXT"
      );
    });

    it("rejects conflicting context options", async () => {
      const harness = createHarness();
      const context = new EngineContext();

      await assert.rejects(
        harness.orchestrator.run({
          context,
          project: { id: "project-1" },
          steps: [step("one", "engine-a")],
        }),
        (error) => error.code === "CONFLICTING_CONTEXT_OPTIONS"
      );
    });

    it("returns project, scene and metadata summaries", async () => {
      const harness = createHarness();

      const result = await harness.orchestrator.run({
        project: { id: "project-001" },
        scene: { id: "scene-001" },
        metadata: { source: "test-suite" },
        steps: [step("one", "engine-a")],
      });

      assert.equal(result.context.projectId, "project-001");
      assert.equal(result.context.sceneId, "scene-001");
      assert.equal(result.context.metadata.source, "test-suite");
    });

    it("returns progress and structured execution events", async () => {
      const harness = createHarness();

      const result = await harness.orchestrator.run({
        steps: [step("one", "engine-a")],
      });

      assert.equal(result.context.progress.value, 100);
      assert.equal(result.context.progress.message, "Completed one");

      assert.ok(
        result.events.some((event) => event.type === "log")
      );

      assert.ok(
        result.events.some((event) =>
          event.type === "progress" &&
          event.value === 100
        )
      );
    });

    it("returns execution timing metadata", async () => {
      const harness = createHarness();

      const result = await harness.orchestrator.run({
        steps: [step("one", "engine-a")],
      });

      assert.equal(typeof result.metadata.startedAt, "string");
      assert.equal(typeof result.metadata.completedAt, "string");
      assert.equal(typeof result.metadata.durationMs, "number");
      assert.ok(result.metadata.durationMs >= 0);
    });
  });
});
