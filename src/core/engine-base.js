
/**
 * ToonForge — Base Engine
 *
 * Provides the common lifecycle and execution contract
 * for all production engines in ToonForge.
 *
 * Every engine should extend EngineBase and implement
 * its own process() method.
 */

export const ENGINE_STATES = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

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
    if (typeof id !== "string" || !id.trim()) {
      throw new TypeError("Engine ID is required.");
    }

    if (typeof name !== "string" || !name.trim()) {
      throw new TypeError("Engine name is required.");
    }

    this.id = id;
    this.name = name;
    this.version = version;
    this.description = description;

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
   * Returns information about the last execution.
   */
  get lastRun() {
    return this._lastRun
      ? { ...this._lastRun }
      : null;
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
   * Validates incoming data.
   * Individual engines can override this method.
   */
  validate(input, context = {}) {
    return {
      valid: true,
      errors: [],
    };
  }

  /**
   * Performs the actual engine operation.
   * Every production engine must implement this method.
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
   * Runs the engine using a standard execution lifecycle.
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

    this._status = ENGINE_STATES.RUNNING;

    try {
      // Validate the incoming input.
      const validation = await this.validate(input, context);

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
            details: validation.errors ?? [],
          }
        );
      }

      // Execute the engine's actual operation.
      const output = await this.process(input, context);

      const completedAtMs = Date.now();
      const completedAt = new Date(completedAtMs).toISOString();

      const metadata = {
        startedAt,
        completedAt,
        durationMs: completedAtMs - startedAtMs,
      };

      this._status = ENGINE_STATES.COMPLETED;

      this._lastRun = {
        status: ENGINE_STATES.COMPLETED,
        ...metadata,
      };

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

      const engineError =
        error instanceof EngineError
          ? error
          : new EngineError(
              error instanceof Error
                ? error.message
                : String(error),
              {
                code: "ENGINE_EXECUTION_FAILED",
                engineId: this.id,
                cause: error,
              }
            );

      this._status = ENGINE_STATES.FAILED;

      this._lastRun = {
        status: ENGINE_STATES.FAILED,
        startedAt,
        completedAt,
        durationMs: completedAtMs - startedAtMs,
        error: {
          code: engineError.code,
          message: engineError.message,
        },
      };

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
