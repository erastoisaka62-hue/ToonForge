/**
 * ToonForge — Core Engine Integration Tests
 *
 * Verifies that the core engine components work together
 * through a real sequential production pipeline.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EngineBase,
} from "../../src/core/engine-base.js";

import {
  EngineRegistry,
} from "../../src/core/engine-registry.js";

import {
  EngineContext,
} from "../../src/core/engine-context.js";

import {
  EngineOrchestrator,
} from "../../src/core/engine-orchestrator.js";

import {
  engineValidator,
} from "../../src/core/engine-validator.js";


class PrepareSceneEngine extends EngineBase {
  constructor() {
    super({
      id: "prepare-scene",
      name: "Prepare Scene Engine",
      version: "1.0.0",
      description: "Prepares initial scene data.",
    });
  }

  async process(input, context) {
    context.setData(
      "scene",
      "prepared",
      true
    );

    return {
      sceneId: input.sceneId,
      initialValue: input.value + 10,
    };
  }
}


class BuildSceneEngine extends EngineBase {
  constructor() {
    super({
      id: "build-scene",
      name: "Build Scene Engine",
      version: "1.0.0",
      description: "Builds scene output from prepared data.",
    });
  }

  async process(input, context) {
    const prepared = context.getData(
      "scene",
      "prepared"
    );

    assert.equal(prepared, true);

    return {
      sceneId: input.sceneId,
      finalValue: input.value * 2,
      built: true,
    };
  }
}


function createIntegrationHarness() {
  const registry = new EngineRegistry();

  const prepareEngine = new PrepareSceneEngine();
  const buildEngine = new BuildSceneEngine();

  registry.register(prepareEngine);
  registry.register(buildEngine);

  const orchestrator = new EngineOrchestrator({
    registry,
    validator: engineValidator,
  });

  return {
    registry,
    orchestrator,
    prepareEngine,
    buildEngine,
  };
}


describe("Core Engine Integration", () => {
  it("registers and discovers production engines", () => {
    const {
      registry,
      prepareEngine,
      buildEngine,
    } = createIntegrationHarness();

    assert.equal(registry.size, 2);

    assert.equal(
      registry.get("prepare-scene"),
      prepareEngine
    );

    assert.equal(
      registry.get("build-scene"),
      buildEngine
    );

    assert.equal(
      registry.has("prepare-scene"),
      true
    );
  });


  it("executes a complete sequential production pipeline", async () => {
    const {
      orchestrator,
      prepareEngine,
      buildEngine,
    } = createIntegrationHarness();

    const result = await orchestrator.run({
      project: {
        id: "project-integration-001",
      },

      scene: {
        id: "scene-integration-001",
      },

      metadata: {
        test: "core-integration",
      },

      steps: [
        {
          id: "prepare",
          engineId: "prepare-scene",

          input: {
            sceneId: "scene-001",
            value: 5,
          },
        },

        {
          id: "build",
          engineId: "build-scene",

          inputFactory: ({ previousResult }) => ({
            sceneId: previousResult.result.output.sceneId,

            value: previousResult.result.output.initialValue,
          }),
        },
      ],
    });

    assert.equal(result.status, "completed");

    assert.deepEqual(result.summary, {
      total: 2,
      completed: 2,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    });

    assert.equal(
      result.steps[0].result.output.initialValue,
      15
    );

    assert.deepEqual(
      result.steps[1].result.output,
      {
        sceneId: "scene-001",
        finalValue: 30,
        built: true,
      }
    );

    assert.equal(
      prepareEngine.status,
      "completed"
    );

    assert.equal(
      buildEngine.status,
      "completed"
    );
  });


  it("shares one execution context across all engines", async () => {
    const {
      orchestrator,
    } = createIntegrationHarness();

    const context = new EngineContext({
      executionId: "integration-context-001",

      project: {
        id: "project-001",
      },

      scene: {
        id: "scene-001",
      },
    });

    const result = await orchestrator.run({
      context,

      steps: [
        {
          id: "prepare",
          engineId: "prepare-scene",

          input: {
            sceneId: "scene-001",
            value: 10,
          },
        },

        {
          id: "build",
          engineId: "build-scene",

          inputFactory: ({ context: sharedContext }) => ({
            sceneId: "scene-001",
            value: sharedContext.getData(
              "orchestrator",
              "prepare"
            ).result.output.initialValue,
          }),
        },
      ],
    });

    assert.equal(
      result.executionId,
      "integration-context-001"
    );

    assert.equal(
      result.context.executionId,
      "integration-context-001"
    );

    assert.equal(
      context.getData("scene", "prepared"),
      true
    );
  });


  it("preserves engine lifecycle after successful execution", async () => {
    const {
      orchestrator,
      prepareEngine,
      buildEngine,
    } = createIntegrationHarness();

    await orchestrator.run({
      steps: [
        {
          id: "prepare",
          engineId: "prepare-scene",
          input: {
            sceneId: "scene-002",
            value: 2,
          },
        },

        {
          id: "build",
          engineId: "build-scene",
          inputFactory: ({ previousResult }) => ({
            sceneId: previousResult.result.output.sceneId,
            value: previousResult.result.output.initialValue,
          }),
        },
      ],
    });

    assert.equal(prepareEngine.status, "completed");
    assert.equal(buildEngine.status, "completed");

    assert.equal(
      prepareEngine.lastRun.status,
      "completed"
    );

    assert.equal(
      buildEngine.lastRun.status,
      "completed"
    );
  });


  it("does not execute engines when preflight validation fails", async () => {
    const registry = new EngineRegistry();

    const engine = new PrepareSceneEngine();

    registry.register(engine);

    const invalidValidator = {
      validateEngine() {
        return {
          valid: false,
          errors: [
            {
              message: "Test validation failure.",
            },
          ],
        };
      },
    };

    const orchestrator = new EngineOrchestrator({
      registry,
      validator: invalidValidator,
    });

    await assert.rejects(
      orchestrator.run({
        steps: [
          {
            id: "prepare",
            engineId: "prepare-scene",
            input: {
              sceneId: "scene-003",
              value: 1,
            },
          },
        ],
      }),

      (error) =>
        error.code === "ENGINE_VALIDATION_FAILED"
    );

    assert.equal(
      engine.status,
      "idle"
    );

    assert.equal(
      engine.lastRun,
      null
    );
  });


  it("continues with later steps when failFast is disabled", async () => {
    class FailingEngine extends EngineBase {
      constructor() {
        super({
          id: "failing-engine",
          name: "Failing Engine",
        });
      }

      async process() {
        throw new Error("Intentional integration failure.");
      }
    }

    const registry = new EngineRegistry();

    const failingEngine = new FailingEngine();
    const prepareEngine = new PrepareSceneEngine();

    registry.register(failingEngine);
    registry.register(prepareEngine);

    const orchestrator = new EngineOrchestrator({
      registry,
      validator: engineValidator,
    });

    const result = await orchestrator.run({
      failFast: false,

      steps: [
        {
          id: "failing",
          engineId: "failing-engine",
          input: {},
        },

        {
          id: "prepare",
          engineId: "prepare-scene",

          input: {
            sceneId: "scene-004",
            value: 3,
          },
        },
      ],
    });

    assert.equal(
      result.status,
      "completed_with_errors"
    );

    assert.equal(
      result.summary.failed,
      1
    );

    assert.equal(
      result.summary.completed,
      1
    );

    assert.equal(
      failingEngine.status,
      "failed"
    );

    assert.equal(
      prepareEngine.status,
      "completed"
    );
  });
});
