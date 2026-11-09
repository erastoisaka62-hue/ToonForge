
/**
 * ToonForge — Engine Orchestrator Tests
 *
 * Covers pipeline validation, preflight checks,
 * sequential execution, input factories, shared context,
 * failure handling, cancellation and execution metadata.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EngineOrchestrator,
} from "../../src/core/engine-orchestrator.js";

import {
  EngineContext,
} from "../../src/core/engine-context.js";

import {
  EngineError,
} from "../../src/core/engine-base.js";

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
      {
        id,
        name: id,
        status: "idle",
      },
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

      return {
        valid: true,
        errors: [],
      };
    },
  };

  const orchestrator = new EngineOrchestrator({
    registry,
    validator,
    maxSteps,
  });

  return {
    orchestrator,
    registry,
    validator,
    calls,
    engineMap,
  };
}

function createStep(id, engineId, input) {
  return { id, engineId, input };
}

describe("EngineOrchestrator", () => {
  describe("constructor", () => {
    it("should accept valid dependencies", () => {
      const harness = createHarness();

      assert.ok(
        harness.orchestrator instanceof EngineOrchestrator
      );
    });

    it("should reject an incompatible registry", () => {
      assert.throws(
        () => new EngineOrchestrator({
          registry: {},
        }),
        TypeError
      );
    });

    it("should reject an incompatible validator", () => {
      assert.throws(
        () => new EngineOrchestrator({
          registry: {
            get() {},
            run() {},
          },
          validator: {},
        }),
        TypeError
      );
    });

    it("should reject invalid maximum step limits", () => {
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
    it("should reject non-object pipeline plans", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run(null),
        (error) => error.code === "INVALID_PIPELINE_PLAN"
      );
    });

    it("should reject empty pipelines", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({ steps: [] }),
        (error) => error.code === "EMPTY_PIPELINE"
      );
    });

    it("should reject missing pipeline steps", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({}),
        (error) => error.code === "INVALID_PIPELINE_STEPS"
      );
    });

    it("should reject unknown pipeline options", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [
            createStep("step-a", "engine-a", {}),
          ],
          unexpected: true,
        }),
        (error) => error.code === "UNKNOWN_PIPELINE_OPTION"
      );
    });

    it("should reject duplicate step IDs", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [
            createStep("duplicate", "engine-a", {}),
            createStep("duplicate", "engine-b", {}),
          ],
        }),
        (error) => error.code === "DUPLICATE_STEP_ID"
      );
    });

    it("should require exactly one input source", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [{
            id: "step-a",
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
            id: "step-a",
            engineId: "engine-a",
          }],
        }),
        (error) => error.code === "INVALID_STEP_INPUT"
      );
    });

    it("should reject non-function input factories", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          steps: [{
            id: "step-a",
            engineId: "engine-a",
            inputFactory: "invalid",
          }],
        }),
        (error) => error.code === "INVALID_INPUT_FACTORY"
      );
    });

    it("should enforce the maximum pipeline step count", async () => {
      const { orchestrator } = createHarness({
        maxSteps: 1,
      });

      await assert.rejects(
        orchestrator.run({
          steps: [
            createStep("step-a", "engine-a", {}),
            createStep("step-b", "engine-b", {}),
          ],
        }),
        (error) => error.code === "PIPELINE_STEP_LIMIT"
      );
    });

    it("should reject sparse pipeline step arrays", async () => {
      const { orchestrator } = createHarness();
      const steps = new Array(1);

      await assert.rejects(
        orchestrator.run({ steps }),
        (error) => error.code === "INVALID_PIPELINE_STEP"
      );
    });

    it("should reject accessor properties without executing their getters", async () => {
      const { orchestrator } = createHarness();

      const step = {
        id: "step-a",
        engineId: "engine-a",
      };

      Object.defineProperty(step, "input", {
        enumerable: true,
        get() {
          throw new Error("Getter must not execute.");
        },
      });

      await assert.rejects(
        orchestrator.run({
          steps: [step],
        }),
        (error) =>
          error instanceof TypeError &&
          error.message.includes(
            "Accessor properties are not allowed"
          )
      );
    });
  });

  describe("engine preflight", () => {
    it("should reject engines that are not registered", async () => {
      const harness = createHarness();

      await assert.rejects(
        harness.orchestrator.run({
          steps: [
            createStep("step-a", "missing-engine", {}),
          ],
        }),
        (error) => error.code === "ENGINE_NOT_FOUND"
      );

      assert.equal(harness.calls.length, 0);
    });

    it("should validate every unique engine before execution", async () => {
      const validated = [];

      const harness = createHarness({
        validateEngine(engine) {
          validated.push(engine.id);

          return {
            valid: true,
            errors: [],
          };
        },
      });

      const result = await harness.orchestrator.run({
        steps: [
          createStep("step-a", "engine-a", {}),
          createStep("step-b", "engine-b", {}),
          createStep("step-c", "engine-a", {}),
        ],
      });

      assert.deepEqual(
        validated,
        ["engine-a", "engine-b"]
      );

      assert.equal(result.status, "completed");
    });

    it("should stop before execution when validation fails", async () => {
      const harness = createHarness({
        validateEngine() {
          return {
            valid: false,
            errors: [{
              code: "INVALID_ENGINE",
              message: "Engine is invalid.",
            }],
          };
        },
      });

      await assert.rejects(
        harness.orchestrator.run({
          steps: [
            createStep("step-a", "engine-a", {}),
          ],
        }),
        (error) => error.code === "ENGINE_VALIDATION_FAILED"
      );

      assert.equal(harness.calls.length, 0);
    });

    it("should wrap unexpected preflight errors", async () => {
      const harness = createHarness({
        validateEngine() {
          throw new Error("Validation crashed.");
        },
      });

      await assert.rejects(
        harness.orchestrator.run({
          steps: [
            createStep("step-a", "engine-a", {}),
          ],
        }),
        (error) => error.code === "ENGINE_PREFLIGHT_FAILED"
      );

      assert.equal(harness.calls.length, 0);
    });
  });

  describe("sequential execution", () => {
    it("should execute steps in the correct order", async () => {
      const harness = createHarness();

      const result = await harness.orchestrator.run({
        steps: [
          createStep("step-a", "engine-a", { value: 1 }),
          createStep("step-b", "engine-b", { value: 2 }),
          createStep("step-c", "engine-c", { value: 3 }),
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

    it("should pass fixed input values to engines", async () => {
      const harness = createHarness();

      await harness.orchestrator.run({
        steps: [
          createStep("character", "engine-a", {
            characterId: "hero-001",
          }),
        ],
      });

      assert.deepEqual(
        harness.calls[0].input,
        { characterId: "hero-001" }
      );
    });

    it("should share one execution context across all engines", async () => {
      const harness = createHarness();

      await harness.orchestrator.run({
        steps: [
          createStep("step-a", "engine-a", {}),
          createStep("step-b", "engine-b", {}),
        ],
      });

      assert.ok(
        harness.calls[0].context instanceof EngineContext
      );

      assert.equal(
        harness.calls[0].context,
        harness.calls[1].context
      );
    });

    it("should return completed results for successful steps", async () => {
      const harness = createHarness({
        run: async (engineId, input) => ({
          engineId,
          output: input.value * 2,
        }),
      });

      const result = await harness.orchestrator.run({
        steps: [
          createStep("step-a", "engine-a", { value: 5 }),
        ],
      });

      assert.equal(result.steps[0].status, "completed");

      assert.deepEqual(
        result.steps[0].result,
        {
          engineId: "engine-a",
          output: 10,
        }
      );
    });

    it("should expose previous results to input factories", async () => {
      const harness = createHarness({
        run: async (engineId, input) => ({
          output: input.value * 2,
        }),
      });

      let receivedPreviousResult;

      const result = await harness.orchestrator.run({
        steps: [
          createStep("first", "engine-a", { value: 5 }),
          {
            id: "second",
            engineId: "engine-b",
            inputFactory: ({ previousResult }) => {
              receivedPreviousResult = previousResult;

              return {
                value: previousResult.result.output,
              };
            },
          },
        ],
      });

      assert.equal(
        receivedPreviousResult.result.output,
        10
      );

      assert.deepEqual(
        harness.calls[1].input,
        { value: 10 }
      );

      assert.equal(result.status, "completed");
    });

    it("should expose earlier results through the results map", async () => {
      const harness = createHarness();

      let receivedResults;

      await harness.orchestrator.run({
        steps: [
          createStep("first", "engine-a", { value: 1 }),
          createStep("second", "engine-b", { value: 2 }),
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

      assert.deepEqual(
        harness.calls[2].input,
        {
          firstOutput: 1,
          secondOutput: 2,
        }
      );
    });

    it("should allow input factories to use the shared context", async () => {
      const harness = createHarness();

      let factoryContext;

      await harness.orchestrator.run({
        steps: [{
          id: "step-a",
          engineId: "engine-a",
          inputFactory: ({ context }) => {
            factoryContext = context;

            return {
              executionId: context.executionId,
            };
          },
        }],
      });

      assert.ok(factoryContext instanceof EngineContext);

      assert.equal(
        harness.calls[0].input.executionId,
        factoryContext.executionId
      );
    });
  });

  describe("failure handling", () => {
    it("should stop after a failure when failFast is enabled", async () => {
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
          createStep("first", "engine-a", {}),
          createStep("second", "engine-b", {}),
        ],
      });

      assert.equal(result.status, "failed");
      assert.equal(result.summary.failed, 1);
      assert.equal(result.summary.skipped, 1);
      assert.equal(harness.calls.length, 1);
      assert.equal(result.steps[1].status, "skipped");
    });

    it("should continue after a failure when failFast is false", async () => {
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
          createStep("first", "engine-a", {}),
          createStep("second", "engine-b", {}),
        ],
      });

      assert.equal(result.status, "completed_with_errors");
      assert.equal(result.summary.failed, 1);
      assert.equal(result.summary.completed, 1);
      assert.equal(harness.calls.length, 2);
    });

    it("should normalize ordinary execution errors", async () => {
      const harness = createHarness({
        run: async () => {
          throw new Error("Rendering failed.");
        },
      });

      const result = await harness.orchestrator.run({
        steps: [
          createStep("render", "engine-a", {}),
        ],
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

    it("should preserve EngineError codes", async () => {
      const harness = createHarness({
        run: async () => {
          throw new EngineError("Invalid scene.", {
            code: "SCENE_INVALID",
          });
        },
      });

      const result = await harness.orchestrator.run({
        steps: [
          createStep("scene", "engine-a", {}),
        ],
      });

      assert.equal(
        result.steps[0].error.code,
        "SCENE_INVALID"
      );
    });

    it("should report failed when every step fails", async () => {
      const harness = createHarness({
        run: async () => {
          throw new Error("Failed.");
        },
      });

      const result = await harness.orchestrator.run({
        failFast: false,
        steps: [
          createStep("first", "engine-a", {}),
          createStep("second", "engine-b", {}),
        ],
      });

      assert.equal(result.status, "failed");
      assert.equal(result.summary.failed, 2);
      assert.equal(result.summary.completed, 0);
    });
  });

  describe("cancellation", () => {
    it("should cancel before starting an engine when already aborted", async () => {
      const harness = createHarness();
      const controller = new AbortController();

      controller.abort(new Error("User cancelled."));

      const result = await harness.orchestrator.run({
        signal: controller.signal,
        steps: [
          createStep("step-a", "engine-a", {}),
        ],
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.summary.cancelled, 1);
      assert.equal(harness.calls.length, 0);
    });

    it("should stop when an input factory cancels execution", async () => {
      const harness = createHarness();
      const controller = new AbortController();

      const result = await harness.orchestrator.run({
        signal: controller.signal,
        steps: [
          {
            id: "step-a",
            engineId: "engine-a",
            inputFactory: () => {
              controller.abort(
                new Error("Cancelled during preparation.")
              );

              return {};
            },
          },
          createStep("step-b", "engine-b", {}),
        ],
      });

      assert.equal(result.status, "cancelled");
      assert.equal(result.summary.cancelled, 1);
      assert.equal(result.summary.skipped, 1);
      assert.equal(harness.calls.length, 0);
    });
  });

  describe("context and metadata", () => {
    it("should use a supplied EngineContext", async () => {
      const harness = createHarness();

      const context = new EngineContext({
        executionId: "test-execution-001",
      });

      const result = await harness.orchestrator.run({
        context,
        steps: [
          createStep("step-a", "engine-a", {}),
        ],
      });

      assert.equal(
        result.executionId,
        "test-execution-001"
      );

      assert.equal(
        harness.calls[0].context,
        context
      );
    });

    it("should reject an invalid supplied context", async () => {
      const { orchestrator } = createHarness();

      await assert.rejects(
        orchestrator.run({
          context: {},
          steps: [
            createStep("step-a", "engine-a", {}),
          ],
        }),
        (error) => error.code === "INVALID_ENGINE_CONTEXT"
      );
    });

    it("should reject conflicting context options", async () => {
      const { orchestrator } = createHarness();
      const context = new EngineContext();

      await assert.rejects(
        orchestrator.run({
          context,
          project: { id: "project-001" },
          steps: [
            createStep("step-a", "engine-a", {}),
          ],
        }),
        (error) => error.code === "CONFLICTING_CONTEXT_OPTIONS"
      );
    });

    it("should include execution summary and timing metadata", async () => {
      const { orchestrator } = createHarness();

      const result = await orchestrator.run({
        project: { id: "project-001" },
        scene: { id: "scene-001" },
        metadata: { source: "test-suite" },
        steps: [
          createStep("step-a", "engine-a", {}),
        ],
      });

      assert.equal(result.status, "completed");
      assert.equal(result.summary.total, 1);
      assert.equal(result.summary.completed, 1);

      assert.equal(
        
