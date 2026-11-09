
/**
 * ToonForge — Engine Registry
 *
 * Central registry for registering, discovering,
 * managing and executing production engines.
 */

import {
  EngineBase,
  EngineError,
} from "./engine-base.js";

export class EngineRegistry {
  constructor() {
    this._engines = new Map();
  }

  /**
   * Register a production engine.
   */
  register(engine) {
    if (!(engine instanceof EngineBase)) {
      throw new EngineError(
        "Only EngineBase instances can be registered.",
        {
          code: "INVALID_ENGINE_INSTANCE",
        }
      );
    }

    if (this._engines.has(engine.id)) {
      throw new EngineError(
        `An engine with ID "${engine.id}" is already registered.`,
        {
          code: "ENGINE_ALREADY_REGISTERED",
          engineId: engine.id,
        }
      );
    }

    this._engines.set(engine.id, engine);

    return engine.getInfo();
  }

  /**
   * Get an engine instance by its ID.
   */
  get(engineId) {
    return this._engines.get(engineId) ?? null;
  }

  /**
   * Check whether an engine is registered.
   */
  has(engineId) {
    return this._engines.has(engineId);
  }

  /**
   * Return information about all registered engines.
   */
  list() {
    return Array.from(
      this._engines.values(),
      (engine) => engine.getInfo()
    );
  }

  /**
   * Return the total number of registered engines.
   */
  get size() {
    return this._engines.size;
  }

  /**
   * Unregister an engine by its ID.
   */
  unregister(engineId) {
    const engine = this.get(engineId);

    if (!engine) {
      return false;
    }

    if (engine.status === "running") {
      throw new EngineError(
        `Cannot unregister "${engineId}" while it is running.`,
        {
          code: "ENGINE_IS_RUNNING",
          engineId,
        }
      );
    }

    return this._engines.delete(engineId);
  }

  /**
   * Execute a registered engine.
   */
  async run(engineId, input, context = {}) {
    const engine = this.get(engineId);

    if (!engine) {
      throw new EngineError(
        `Engine "${engineId}" is not registered.`,
        {
          code: "ENGINE_NOT_FOUND",
          engineId,
        }
      );
    }

    return engine.run(input, context);
  }

  /**
   * Remove all registered engines.
   *
   * Running engines cannot be removed.
   */
  clear() {
    const runningEngine = this.list().find(
      (engine) => engine.status === "running"
    );

    if (runningEngine) {
      throw new EngineError(
        `Cannot clear registry while "${runningEngine.id}" is running.`,
        {
          code: "REGISTRY_CLEAR_BLOCKED",
          engineId: runningEngine.id,
        }
      );
    }

    this._engines.clear();

    return true;
  }
}

/**
 * Shared registry instance for the application.
 */
export const engineRegistry = new EngineRegistry();
        
