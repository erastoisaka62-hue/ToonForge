
/**
 * ToonForge — Engine Orchestrator
 *
 * Coordinates multiple production engines through
 * a controlled, sequential execution pipeline.
 *
 * Features:
 * - Pipeline preflight validation.
 * - Sequential engine execution.
 * - Shared EngineContext.
 * - Output passing between pipeline steps.
 * - Execution cancellation.
 * - Fail-fast and continue-on-error modes.
 * - Progress reporting and structured logs.
 * - Per-step execution results.
 */

import { EngineError } from "./engine-base.js";
import { EngineContext } from "./engine-context.js";
import { engineRegistry } from "./engine-registry.js";
import { engineValidator } from "./engine-validator.js";

const PLAN_KEYS = new Set([
  "steps",
  "context",
  "project",
  "scene",
  "metadata",
  "signal",
  "executionId",
  "parentExecutionId",
  "failFast",
]);

const STEP_KEYS = new Set([
  "id",
  "engineId",
  "input",
  "inputFactory",
]);

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function readOwnValue(object, key, fallback = undefined) {
  const descriptor = Object.getOwnPropertyDescriptor(
    object,
    key
  );

  if (!descriptor) {
    return fallback;
  }

  if (!Object.prototype.hasOwnProperty.call(
    descriptor,
    "value"
  )) {
    throw new TypeError(
      `Accessor properties are not allowed: "${key}".`
    );
  }

  return descriptor.value;
}

function requireIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new TypeError(
      `${label} must be a non-empty string without surrounding whitespace.`
    );
  }

  return value;
}

function normalizeStep(step, index) {
  if (!isPlainObject(step)) {
    throw new EngineError(
      `Pipeline step ${index} must be a plain object.`,
      {
        code: "INVALID_PIPELINE_STEP",
        details: { stepIndex: index },
      }
    );
  }

  for (const key of Object.keys(step)) {
    if (!STEP_KEYS.has(key)) {
      throw new EngineError(
        `Unknown property "${key}" in pipeline step ${index}.`,
        {
          code: "UNKNOWN_STEP_PROPERTY",
          details: {
            stepIndex: index,
            property: key,
          },
        }
      );
    }
  }

  const id = requireIdentifier(
    readOwnValue(step, "id"),
    `Step ${index} ID`
  );

  const engineId = requireIdentifier(
    readOwnValue(step, "engineId"),
    `Step ${index} engineId`
  );

  const hasInput = Object.prototype.hasOwnProperty.call(
    step,
    "input"
  );

  const hasInputFactory =
    Object.prototype.hasOwnProperty.call(
      step,
      "inputFactory"
    );

  if (hasInput === hasInputFactory) {
    throw new EngineError(
      `Step "${id}" must define exactly one of input or inputFactory.`,
      {
        code: "INVALID_STEP_INPUT",
        details: { stepId: id },
      }
    );
  }

  const input = hasInput
    ? readOwnValue(step, "input")
    : undefined;

  const inputFactory = hasInputFactory
    ? readOwnValue(step, "inputFactory")
    : null;

  if (
    hasInputFactory &&
    typeof inputFactory !== "function"
  ) {
    throw new EngineError(
      `inputFactory for step "${id}" must be a function.`,
      {
        code: "INVALID_INPUT_FACTORY",
        details: { stepId: id },
      }
    );
  }

  return Object.freeze({
    id,
    engineId,
    input,
    inputFactory,
  });
}

function normalizePlan(plan, maxSteps) {
  if (!isPlainObject(plan)) {
    throw new EngineError(
      "Pipeline plan must be a plain object.",
      {
        code: "INVALID_PIPELINE_PLAN",
      }
    );
  }

  for (const key of Object.keys(plan)) {
    if (!PLAN_KEYS.has(key)) {
      throw new EngineError(
        `Unknown pipeline option "${key}".`,
        {
          code: "UNKNOWN_PIPELINE_OPTION",
          details: { property: key },
        }
      );
    }
  }

  const steps = readOwnValue(plan, "steps");

  if (!Array.isArray(steps)) {
    throw new EngineError(
      "Pipeline steps must be an array.",
      {
        code: "INVALID_PIPELINE_STEPS",
      }
    );
  }

  if (steps.length === 0) {
    throw new EngineError(
      "Pipeline must contain at least one step.",
      {
        code: "EMPTY_PIPELINE",
      }
    );
  }

  if (steps.length > maxSteps) {
    throw new EngineError(
      `Pipeline exceeds the maximum of ${maxSteps} steps.`,
      {
        code: "PIPELINE_STEP_LIMIT",
        details: {
          provided: steps.length,
          maximum: maxSteps,
        },
      }
    );
  }

  const normalizedSteps = [];
  const stepIds = new Set();

  for (let index = 0; index < steps.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      steps,
      String(index)
    );

    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      throw new EngineError(
        `Pipeline step ${index} is missing or is an accessor.`,
        {
          code: "INVALID_PIPELINE_STEP",
          details: { stepIndex: index },
        }
      );
    }

    const step = normalizeStep(descriptor.value, index);

    if (stepIds.has(step.id)) {
      throw new EngineError(
        `Duplicate pipeline step ID "${step.id}".`,
        {
          code: "DUPLICATE_STEP_ID",
          details: { stepId: step.id },
        }
      );
    }

    stepIds.add(step.id);
    normalizedSteps.push(step);
  }

  const failFast = readOwnValue(plan, "failFast", true);

  if (typeof failFast !== "boolean") {
    throw new TypeError(
      "Pipeline failFast option must be a boolean."
    );
  }

  return {
    steps: normalizedSteps,
    failFast,
  };
}

function normalizeError(error) {
  if (error instanceof EngineError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: "PIPELINE_STEP_FAILED",
    message: error instanceof Error
      ? error.message
      : String(error),
  };
}

/**
 * Central coordinator for ToonForge production pipelines.
 */
export class EngineOrchestrator {
  #registry;
  #validator;
  #maxSteps;

  constructor({
    registry = engineRegistry,
    validator = engineValidator,
    maxSteps = 2000,
  } = {}) {
    if (
      !registry ||
      typeof registry.get !== "function" ||
      typeof registry.run !== "function"
    ) {
      throw new TypeError(
        "A compatible EngineRegistry is required."
      );
    }

    if (
      !validator ||
      typeof validator.validateEngine !== "function"
    ) {
      throw new TypeError(
        "A compatible EngineValidator is required."
      );
    }

    if (
      !Number.isSafeInteger(maxSteps) ||
      maxSteps < 1 ||
      maxSteps > 10000
    ) {
      throw new RangeError(
        "maxSteps must be between 1 and 10000."
      );
    }

    this.#registry = registry;
    this.#validator = validator;
    this.#maxSteps = maxSteps;
  }

  /**
   * Validate every referenced engine before starting execution.
   * No production engine is executed during preflight.
   */
  #preflight(steps) {
    const checkedEngines = new Set();

    for (const step of steps) {
      if (checkedEngines.has(step.engineId)) {
        continue;
      }

      const engine = this.#registry.get(step.engineId);

      if (!engine) {
        throw new EngineError(
          `Engine "${step.engineId}" is not registered.`,
          {
            code: "ENGINE_NOT_FOUND",
            engineId: step.engineId,
          }
        );
      }

      let validation;

      try {
        validation = this.#validator.validateEngine(engine);
      } catch (error) {
        throw new EngineError(
          `Engine "${step.engineId}" could not be validated.`,
          {
            code: "ENGINE_PREFLIGHT_FAILED",
            engineId: step.engineId,
            cause: error,
          }
        );
      }

      if (
        !validation ||
        validation.valid !== true ||
        !Array.isArray(validation.errors)
      ) {
        throw new EngineError(
          `Engine "${step.engineId}" failed preflight validation.`,
          {
            code: "ENGINE_VALIDATION_FAILED",
            engineId: step.engineId,
            details: {
              errors: validation?.errors ?? [],
            },
          }
        );
      }

      checkedEngines.add(step.engineId);
    }
  }

  /**
   * Create or validate the shared execution context.
   */
  #createContext(plan) {
    const providedContext = readOwnValue(
      plan,
      "context",
      null
    );

    if (providedContext !== null) {
      if (!(providedContext instanceof EngineContext)) {
        throw new EngineError(
          "Provided context must be an EngineContext instance.",
          {
            code: "INVALID_ENGINE_CONTEXT",
          }
        );
      }

      const conflictingOptions = [
        "project",
        "scene",
        "metadata",
        "signal",
        "executionId",
        "parentExecutionId",
      ];

      for (const key of conflictingOptions) {
        if (
          Object.prototype.hasOwnProperty.call(plan, key)
        ) {
          throw new EngineError(
            `Do not combine context with the "${key}" option.`,
            {
              code: "CONFLICTING_CONTEXT_OPTIONS",
              details: { property: key },
            }
          );
        }
      }

      return providedContext;
    }

    return new EngineContext({
      project: readOwnValue(plan, "project", null),
      scene: readOwnValue(plan, "scene", null),
      metadata: readOwnValue(plan, "metadata", {}),
      signal: readOwnValue(plan, "signal", null),
      executionId: readOwnValue(plan, "executionId", null),
      parentExecutionId: readOwnValue(
        plan,
        "parentExecutionId",
        null
      ),
    });
  }

  /**
   * Execute a sequential production pipeline.
   *
   * Steps can use:
   * - input: a fixed input value.
   * - inputFactory: an async function that builds input
   *   from the shared context and earlier results.
   */
  async run(plan) {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();

    const normalizedPlan = normalizePlan(
      plan,
      this.#maxSteps
    );

    const { steps, failFast } = normalizedPlan;

    // Validate all engines before any engine starts.
    this.#preflight(steps);

    const context = this.#createContext(plan);

    const resultsByStep = new Map();
    const stepResults = [];

    let previousResult = null;
    let stopReason = null;
    let cancelled = false;

    context.log(
      "info",
      "Production pipeline started.",
      {
        totalSteps: steps.length,
        failFast,
      }
    );

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const progress = ((index + 1) / steps.length) * 100;

      if (stopReason !== null) {
        const skippedResult = {
          id: step.id,
          engineId: step.engineId,
          status: "skipped",
          reason: stopReason,
        };

        stepResults.push(skippedResult);

        context.log(
          "warn",
          `Step "${step.id}" was skipped.`,
          {
            stepId: step.id,
            reason: stopReason,
          }
        );

        context.reportProgress(
          progress,
          `Skipped ${step.id}`
        );

        continue;
      }

      try {
        context.throwIfAborted();

        context.log(
          "info",
          `Starting step "${step.id}".`,
          {
            stepId: step.id,
            engineId: step.engineId,
            stepNumber: index + 1,
          }
        );

        let input = step.input;

        if (step.inputFactory) {
          input = await step.inputFactory({
            context,
            results: new Map(resultsByStep),
            previousResult,
            step: Object.freeze({
              id: step.id,
              engineId: step.engineId,
            }),
          });
        }

        // Do not start a new engine if cancellation happened
        // while an input factory was preparing its input.
        context.throwIfAborted();

        const engineResult = await this.#registry.run(
          step.engineId,
          input,
          context
        );

        // Engines should cooperate with cancellation, but the
        // orchestrator also checks the signal after each step.
        context.throwIfAborted();

        const completedResult = {
          id: step.id,
          engineId: step.engineId,
          status: "completed",
          result: engineResult,
        };

        stepResults.push(completedResult);
        resultsByStep.set(step.id, completedResult);
        previousResult = completedResult;

        context.setData(
          "orchestrator",
          step.id,
          completedResult
        );

        context.log(
          "info",
          `Step "${step.id}" completed.`,
          {
            stepId: step.id,
            engineId: step.engineId,
          }
        );

        context.reportProgress(
          progress,
          `Completed ${step.id}`
        );
      } catch (error) {
        const normalizedError = normalizeError(error);
        const wasCancelled =
          context.isAborted ||
          normalizedError.code === "EXECUTION_ABORTED";

        const failedResult = {
          id: step.id,
          engineId: step.engineId,
          status: wasCancelled ? "cancelled" : "failed",
          error: normalizedError,
        };

        stepResults.push(failedResult);

        context.log(
          wasCancelled ? "warn" : "error",
          `Step "${step.id}" ${wasCancelled ? "was cancelled" : "failed"}.`,
          {
            stepId: step.id,
            engineId: step.engineId,
            errorCode: normalizedError.code,
          }
        );

        context.reportProgress(
          progress,
          wasCancelled
            ? `Cancelled ${step.id}`
            : `Failed ${step.id}`
        );

        if (wasCancelled) {
          cancelled = true;
          stopReason = "execution_cancelled";
        } else if (failFast) {
          stopReason = "fail_fast";
        }
      }
    }

    const completedAtMs = Date.now();
    const completedAt = new Date(completedAtMs).toISOString();

    const summary = {
      total: stepResults.length,
      completed: stepResults.filter(
        (result) => result.status === "completed"
      ).length,
      failed: stepResults.filter(
        (result) => result.status === "failed"
      ).length,
      cancelled: stepResults.filter(
        (result) => result.status === "cancelled"
      ).length,
      skipped: stepResults.filter(
        (result) => result.status === "skipped"
      ).length,
    };

    let status;

    if (cancelled) {
      status = "cancelled";
    } else if (summary.failed > 0) {
      status = summary.completed > 0
        ? "completed_with_errors"
        : "failed";
    } else {
      status = "completed";
    }

    context.log(
      status === "completed" ? "info" : "warn",
      `Production pipeline finished with status "${status}".`,
      summary
    );

    return {
      executionId: context.executionId,
      status,
      summary,
      steps: stepResults,
      context: context.getInfo(),
      events: context.getEvents(),
      metadata: {
        startedAt,
        completedAt,
        durationMs: completedAtMs - startedAtMs,
      },
    };
  }
}

/**
 * Shared application-level orchestrator.
 */
export const engineOrchestrator = new EngineOrchestrator();
      
