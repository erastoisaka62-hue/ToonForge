/**
 * ToonForge — Base Engine
 *
 * Defines the shared lifecycle contract for every production engine.
 * Engines should extend EngineBase and implement process().
 */

import { engineEvents } from "./engine-events.js";

export const ENGINE_STATES = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const LIFECYCLE_EVENTS = Object.freeze({
  STARTED: "engine:started",
  COMPLETED: "engine:completed",
  FAILED: "engine:failed",
  CANCELLED: "engine:cancelled",
});

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function getContextExecutionId(context) {
  return typeof context?.executionId === "string"
    ? context.executionId
    : null;
}

function isContextAborted(context) {
  return (
    context?.isAborted === true ||
    context?.signal?.aborted === true
  );
}

function throwIfAborted(context, engineId) {
  if (typeof context?.throwIfAborted === "function") {
    context.throwIfAborted();
    return;
  }

  if (!isContextAborted(context)) {
    return;
  }

  const reason = context?.signal?.reason;

  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "Execution was cancelled.";

  throw new EngineError(message, {
    code: "EXECUTION_ABORTED",
    engineId,
    details: { reason: message },
    ...(reason instanceof Error ? { cause: reason } : {}),
  });
}

function publishLifecycleEvent(eventName, payload) {
  // Lifecycle notifications must not break production work.
  try {
    return engineEvents.emit(eventName, payload);
  } catch (error) {
    return {
      event: null,
      delivered: 0,
      errors: [{ error }],
    };
  }
}

function normalizeExecutionError(error, engineId, context) {
  let normalized = error instanceof EngineError
    ? error
    : new EngineError(
        error instanceof Error ? error.message : String(error),
        {
          code: "ENGINE_EXECUTION_FAILED",
          engineId,
          cause: error,
        }
      );

  if (normalized.engineId === null) {
    normalized = new EngineError(normalized.message, {
      code: normalized.code,
      engineId,
      details: normalized.details,
      cause: normalized,
    });
  }

  if (
    isContextAborted(context) &&
    normalized.code !== "EXECUTION_ABORTED"
  ) {
    normalized = new EngineError("Execution was cancelled.", {
      code: "EXECUTION_ABORTED",
      engineId,
      details: {
        originalError: normalized.message,
      },
      cause: normalized,
    });
  }

  return normalized;
}

/**
 * Standard error type used by ToonForge engines.
 */
export class EngineError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = "EngineError";
    this.code = options.code ?? "ENGINE_ERROR";
    this.engineId = options.engineId ?? null;
    this.details = options.details ?? null;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Base class for all ToonForge production engines.
 */
export class EngineBase {
  constructor({
    id,
    name,
    version = "0.1.0",
    description = "",
  } = {}) {
    this.id = requireNonEmptyString(id, "Engine ID");
    this.name = requireNonEmptyString(name, "Engine name");

    if (
      typeof version !== "string" ||
      version.trim().length === 0
    ) {
      throw new TypeError(
        "Engine version must be a non-empty string."
      );
    }

    if (typeof description !== "string") {
      throw new TypeError(
        "Engine description must be a string."
      );
    }

    this.version = version.trim();
    this.description = description.trim();

    this._status = ENGINE_STATES.IDLE;
    this._lastRun = null;
  }

  /**
   * Returns the current engine status.
   */
  get status() {
    return this._status;
  }

  /**
   * Returns a snapshot of the last execution.
   */
  get lastRun() {
    if (!this._lastRun) {
      return null;
    }

    return {
      ...this._lastRun,
      ...(this._lastRun.error
        ? { error: { ...this._lastRun.error } }
        : {}),
    };
  }

  /**
   * Returns basic engine information.
   */
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      status: this._status,
    };
  }

  /**
   * Override this method to validate engine-specific input.
   */
  validate(input, context = {}) {
    return {
      valid: true,
      errors: [],
    };
  }

  /**
   * Every concrete production engine must implement process().
   */
  async process(input, context = {}) {
    throw new EngineError(
      `The process() method has not been implemented for ${this.name}.`,
      {
        code: "ENGINE_NOT_IMPLEMENTED",
        engineId: this.id,
      }
    );
  }

  /**
   * Executes validation and processing under the shared lifecycle.
   */
  async run(input, context = {}) {
    if (this._status === ENGINE_STATES.RUNNING) {
      throw new EngineError(
        `${this.name} is already running.`,
        {
          code: "ENGINE_ALREADY_RUNNING",
          engineId: this.id,
        }
      );
    }

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const executionId = getContextExecutionId(context);

    this._status = ENGINE_STATES.RUNNING;

    this._lastRun = {
      status: ENGINE_STATES.RUNNING,
      startedAt,
      completedAt: null,
      durationMs: 0,
    };

    publishLifecycleEvent(LIFECYCLE_EVENTS.STARTED, {
      engineId: this.id,
      engineName: this.name,
      engineVersion: this.version,
      executionId,
      startedAt,
    });

    try {
      // Check cancellation before validation.
      throwIfAborted(context, this.id);

      const validation = await this.validate(input, context);

      // Check again in case validation took a long time.
      throwIfAborted(context, this.id);

      if (
        !validation ||
        typeof validation.valid !== "boolean"
      ) {
        throw new EngineError(
          `Invalid validation response from ${this.name}.`,
          {
            code: "INVALID_VALIDATION_RESULT",
            engineId: this.id,
          }
        );
      }

      if (!validation.valid) {
        throw new EngineError(
          `Input validation failed for ${this.name}.`,
          {
            code: "INPUT_VALIDATION_FAILED",
            engineId: this.id,
            details: Array.isArray(validation.errors)
              ? validation.errors
              : [],
          }
        );
      }

      // Execute the actual engine operation.
      const output = await this.process(input, context);

      // Never report success after cancellation.
      throwIfAborted(context, this.id);

      const completedAtMs = Date.now();
      const completedAt = new Date(completedAtMs).toISOString();

      const metadata = {
        startedAt,
        completedAt,
        durationMs: Math.max(
          0,
          completedAtMs - startedAtMs
        ),
      };

      this._status = ENGINE_STATES.COMPLETED;

      this._lastRun = {
        status: ENGINE_STATES.COMPLETED,
        ...metadata,
      };

      publishLifecycleEvent(LIFECYCLE_EVENTS.COMPLETED, {
        engineId: this.id,
        engineName: this.name,
        engineVersion: this.version,
        executionId,
        ...metadata,
      });

      return {
        engineId: this.id,
        engineVersion: this.version,
        status: ENGINE_STATES.COMPLETED,
        output,
        metadata,
      };
    } catch (error) {
      const completedAtMs = Date.now();
      const completedAt = new Date(completedAtMs).toISOString();

      const engineError = normalizeExecutionError(
        error,
        this.id,
        context
      );

      const cancelled =
        engineError.code === "EXECUTION_ABORTED";

      const finalStatus = cancelled
        ? ENGINE_STATES.CANCELLED
        : ENGINE_STATES.FAILED;

      const metadata = {
        startedAt,
        completedAt,
        durationMs: Math.max(
          0,
          completedAtMs - startedAtMs
        ),
      };

      this._status = finalStatus;

      this._lastRun = {
        status: finalStatus,
        ...metadata,
        error: {
          code: engineError.code,
          message: engineError.message,
        },
      };

      publishLifecycleEvent(
        cancelled
          ? LIFECYCLE_EVENTS.CANCELLED
          : LIFECYCLE_EVENTS.FAILED,
        {
          engineId: this.id,
          engineName: this.name,
          engineVersion: this.version,
          executionId,
          ...metadata,
          error: {
            code: engineError.code,
            message: engineError.message,
          },
        }
      );

      throw engineError;
    }
  }

  /**
   * Resets the engine to its initial state.
   */
  reset() {
    if (this._status === ENGINE_STATES.RUNNING) {
      throw new EngineError(
        "Cannot reset an engine while it is running.",
        {
          code: "ENGINE_RESET_BLOCKED",
          engineId: this.id,
        }
      );
    }

    this._status = ENGINE_STATES.IDLE;
    this._lastRun = null;

    return this.getInfo();
  }
  }
