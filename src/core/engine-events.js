
/**
 * ToonForge — Engine Event Bus
 *
 * A lightweight event system for communication
 * between production engines and application services.
 *
 * Features:
 * - Named event subscriptions.
 * - One-time listeners.
 * - Synchronous and asynchronous dispatch.
 * - Listener priorities.
 * - AbortSignal-based cleanup.
 * - Safe listener removal during dispatch.
 * - Isolated listener errors.
 * - Listener count inspection.
 * - No external dependencies.
 */

let listenerSequence = 0;

const NOOP = () => {};

function requireEventName(eventName) {
  if (
    typeof eventName !== "string" ||
    eventName.trim().length === 0 ||
    eventName.trim() !== eventName
  ) {
    throw new TypeError(
      "Event name must be a non-empty string without surrounding whitespace."
    );
  }

  return eventName;
}

function requireHandler(handler) {
  if (typeof handler !== "function") {
    throw new TypeError("Event listener must be a function.");
  }

  return handler;
}

function normalizeOptions(options = {}) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("Listener options must be an object.");
  }

  const allowedKeys = new Set(["priority", "signal"]);

  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`Unknown listener option "${key}".`);
    }
  }

  const priority = options.priority ?? 0;
  const signal = options.signal ?? null;

  if (
    typeof priority !== "number" ||
    !Number.isFinite(priority)
  ) {
    throw new TypeError("Listener priority must be finite.");
  }

  if (
    signal !== null &&
    (
      typeof signal !== "object" ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function"
    )
  ) {
    throw new TypeError("Listener signal must be AbortSignal-compatible.");
  }

  return { priority, signal };
}

function createDispatchResult(event, delivered, errors) {
  return Object.freeze({
    event,
    delivered,
    errors: Object.freeze([...errors]),
  });
}

export class EngineEventBus {
  #listeners;
  #maxListeners;

  constructor({ maxListeners = 100 } = {}) {
    if (
      !Number.isSafeInteger(maxListeners) ||
      maxListeners < 1 ||
      maxListeners > 10000
    ) {
      throw new RangeError(
        "maxListeners must be an integer between 1 and 10000."
      );
    }

    this.#listeners = new Map();
    this.#maxListeners = maxListeners;
  }

  on(eventName, handler, options = {}) {
    return this.#addListener(eventName, handler, options, false);
  }

  once(eventName, handler, options = {}) {
    return this.#addListener(eventName, handler, options, true);
  }

  #addListener(eventName, handler, options, once) {
    const name = requireEventName(eventName);
    const callback = requireHandler(handler);
    const normalized = normalizeOptions(options);

    if (normalized.signal?.aborted) {
      return NOOP;
    }

    let listeners = this.#listeners.get(name);

    if (!listeners) {
      listeners = new Map();
      this.#listeners.set(name, listeners);
    }

    if (listeners.size >= this.#maxListeners) {
      throw new RangeError(
        `Event "${name}" reached its listener limit of ${this.#maxListeners}.`
      );
    }

    const id = ++listenerSequence;

    const entry = {
      id,
      handler: callback,
      once,
      priority: normalized.priority,
      signal: normalized.signal,
      abortHandler: null,
    };

    listeners.set(id, entry);

    const unsubscribe = () => {
      this.#removeListenerById(name, id);
    };

    if (normalized.signal) {
      entry.abortHandler = unsubscribe;

      normalized.signal.addEventListener(
        "abort",
        unsubscribe,
        { once: true }
      );

      if (normalized.signal.aborted) {
        unsubscribe();
      }
    }

    return unsubscribe;
  }

  off(eventName, handler) {
    const name = requireEventName(eventName);
    const listeners = this.#listeners.get(name);

    if (!listeners) {
      return 0;
    }

    if (
      handler !== undefined &&
      typeof handler !== "function"
    ) {
      throw new TypeError("Handler must be a function.");
    }

    let removed = 0;

    for (const entry of [...listeners.values()]) {
      if (
        handler === undefined ||
        entry.handler === handler
      ) {
        if (this.#removeListenerById(name, entry.id)) {
          removed += 1;
        }
      }
    }

    return removed;
  }

  /**
   * Synchronous dispatch.
   * Use emitAsync() for listeners that must be awaited.
   */
  emit(eventName, payload = undefined) {
    const name = requireEventName(eventName);
    const event = Object.freeze({
      type: name,
      payload,
      timestamp: new Date().toISOString(),
    });

    const listeners = this.#getOrderedListeners(name);
    const errors = [];
    let delivered = 0;

    for (const entry of listeners) {
      if (!this.#hasListener(name, entry.id)) {
        continue;
      }

      if (entry.once) {
        this.#removeListenerById(name, entry.id);
      }

      try {
        const result = entry.handler(event);

        if (
          result !== null &&
          result !== undefined &&
          typeof result.then === "function"
        ) {
          Promise.resolve(result).catch(NOOP);

          throw new TypeError(
            "Asynchronous listeners require emitAsync()."
          );
        }

        delivered += 1;
      } catch (error) {
        errors.push(
          Object.freeze({
            listenerId: entry.id,
            error,
          })
        );
      }
    }

    return createDispatchResult(event, delivered, errors);
  }

  /**
   * Sequential asynchronous dispatch.
   */
  async emitAsync(eventName, payload = undefined) {
    const name = requireEventName(eventName);
    const event = Object.freeze({
      type: name,
      payload,
      timestamp: new Date().toISOString(),
    });

    const listeners = this.#getOrderedListeners(name);
    const errors = [];
    let delivered = 0;

    for (const entry of listeners) {
      if (!this.#hasListener(name, entry.id)) {
        continue;
      }

      if (entry.once) {
        this.#removeListenerById(name, entry.id);
      }

      try {
        await entry.handler(event);
        delivered += 1;
      } catch (error) {
        errors.push(
          Object.freeze({
            listenerId: entry.id,
            error,
          })
        );
      }
    }

    return createDispatchResult(event, delivered, errors);
  }

  #getOrderedListeners(eventName) {
    const listeners = this.#listeners.get(eventName);

    if (!listeners) {
      return [];
    }

    return [...listeners.values()].sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      return a.id - b.id;
    });
  }

  #hasListener(eventName, listenerId) {
    return (
      this.#listeners.get(eventName)?.has(listenerId) ?? false
    );
  }

  #removeListenerById(eventName, listenerId) {
    const listeners = this.#listeners.get(eventName);

    if (!listeners) {
      return false;
    }

    const entry = listeners.get(listenerId);

    if (!entry) {
      return false;
    }

    listeners.delete(listenerId);

    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener(
        "abort",
        entry.abortHandler
      );
    }

    if (listeners.size === 0) {
      this.#listeners.delete(eventName);
    }

    return true;
  }

  listenerCount(eventName) {
    const name = requireEventName(eventName);
    return this.#listeners.get(name)?.size ?? 0;
  }

  get eventCount() {
    return this.#listeners.size;
  }

  clear(eventName = null) {
    if (eventName === null) {
      let removed = 0;

      for (const name of [...this.#listeners.keys()]) {
        removed += this.off(name);
      }

      return removed;
    }

    return this.off(eventName);
  }
}

export const engineEvents = new EngineEventBus();
  
