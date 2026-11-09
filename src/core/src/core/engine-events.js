
/**
 * ToonForge — Engine Events
 *
 * Dependency-free event bus for communication between
 * production engines and application services.
 *
 * Features:
 * - Namespaced event subscriptions.
 * - Wildcard subscriptions.
 * - One-time listeners.
 * - AbortSignal-based unsubscription.
 * - Synchronous and asynchronous event delivery.
 * - Listener error isolation.
 * - Listener-count safeguards.
 * - Immutable event envelopes (payload remains caller-owned).
 */

const DEFAULT_MAX_LISTENERS = 50;
const MAX_EVENT_NAME_LENGTH = 128;

export const ENGINE_EVENTS = Object.freeze({
  ENGINE_STARTED: "engine:started",
  ENGINE_COMPLETED: "engine:completed",
  ENGINE_FAILED: "engine:failed",
  PIPELINE_STARTED: "pipeline:started",
  PIPELINE_PROGRESS: "pipeline:progress",
  PIPELINE_COMPLETED: "pipeline:completed",
  PIPELINE_FAILED: "pipeline:failed",
  PIPELINE_CANCELLED: "pipeline:cancelled",
});

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
  const descriptor = Object.getOwnPropertyDescriptor(object, key);

  if (!descriptor) {
    return fallback;
  }

  if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw new TypeError(
      `Accessor properties are not allowed for option "${key}".`
    );
  }

  return descriptor.value;
}

function validateOptionKeys(options, allowedKeys, label) {
  if (!isPlainObject(options)) {
    throw new TypeError(`${label} must be a plain object.`);
  }

  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`Unknown ${label} option "${key}".`);
    }

    readOwnValue(options, key);
  }
}

function validateEventName(eventName, { allowWildcard = false } = {}) {
  if (allowWildcard && eventName === "*") {
    return eventName;
  }

  if (
    typeof eventName !== "string" ||
    eventName.length === 0 ||
    eventName.length > MAX_EVENT_NAME_LENGTH ||
    !/^[a-z][a-z0-9:_./-]*$/i.test(eventName)
  ) {
    throw new TypeError(
      `Event name must start with a letter and contain only letters, numbers, ':', '_', '.', '/', or '-'. Maximum length is ${MAX_EVENT_NAME_LENGTH}.`
    );
  }

  return eventName;
}

function validateSignal(signal) {
  if (signal === null || signal === undefined) {
    return null;
  }

  if (
    typeof signal !== "object" ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    throw new TypeError(
      "signal must be an AbortSignal-compatible object."
    );
  }

  return signal;
}

function normalizeSubscriptionOptions(options = {}) {
  const allowedKeys = new Set(["once", "signal"]);
  validateOptionKeys(options, allowedKeys, "subscription");

  const once = readOwnValue(options, "once", false);
  const signal = validateSignal(readOwnValue(options, "signal", null));

  if (typeof once !== "boolean") {
    throw new TypeError("Subscription once option must be a boolean.");
  }

  return { once, signal };
}

function normalizeEventOptions(options = {}) {
  const allowedKeys = new Set([
    "source",
    "executionId",
    "metadata",
  ]);
  validateOptionKeys(options, allowedKeys, "event");

  const source = readOwnValue(options, "source", null);
  const executionId = readOwnValue(options, "executionId", null);
  const metadata = readOwnValue(options, "metadata", {});

  if (source !== null && typeof source !== "string") {
    throw new TypeError("Event source must be a string or null.");
  }

  if (executionId !== null && typeof executionId !== "string") {
    throw new TypeError("Event executionId must be a string or null.");
  }

  if (!isPlainObject(metadata)) {
    throw new TypeError("Event metadata must be a plain object.");
  }

  const metadataSnapshot = Object.create(null);

  for (const key of Object.keys(metadata)) {
    metadataSnapshot[key] = readOwnValue(metadata, key);
  }

  return {
    source,
    executionId,
    metadata: Object.freeze(metadataSnapshot),
  };
}

function describeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    error,
  };
}

/**
 * Event bus for engine lifecycle and production workflow events.
 */
export class EngineEventBus {
  #listeners;
  #listenerSequence;
  #eventSequence;
  #maxListeners;
  #disposed;

  constructor({ maxListeners = DEFAULT_MAX_LISTENERS } = {}) {
    if (!Number.isSafeInteger(maxListeners) || maxListeners < 1 || maxListeners > 10000) {
      throw new RangeError(
        "maxListeners must be a safe integer between 1 and 10000."
      );
    }

    this.#listeners = new Map();
    this.#listenerSequence = 0;
    this.#eventSequence = 0;
    this.#maxListeners = maxListeners;
    this.#disposed = false;
  }

  /** Subscribe to an event. Use '*' to receive every event. */
  on(eventName, listener, options = {}) {
    this.#assertActive();
    validateEventName(eventName, { allowWildcard: true });

    if (typeof listener !== "function") {
      throw new TypeError("Event listener must be a function.");
    }

    const normalizedOptions = normalizeSubscriptionOptions(options);
    const { once, signal } = normalizedOptions;

    if (signal?.aborted) {
      return () => false;
    }

    const entries = this.#listeners.get(eventName) ?? [];

    if (entries.length >= this.#maxListeners) {
      throw new RangeError(
        `Maximum listener count (${this.#maxListeners}) reached for event "${eventName}".`
      );
    }

    const record = {
      id: ++this.#listenerSequence,
      listener,
      once,
      active: true,
      signal,
      abortHandler: null,
    };

    entries.push(record);
    this.#listeners.set(eventName, entries);

    const unsubscribe = () => this.#removeRecord(eventName, record);

    if (signal) {
      record.abortHandler = unsubscribe;
      signal.addEventListener("abort", record.abortHandler, { once: true });

      // Cover an abort that races with listener registration.
      if (signal.aborted) {
        unsubscribe();
      }
    }

    return unsubscribe;
  }

  /** Subscribe to an event exactly once. */
  once(eventName, listener, options = {}) {
    const allowedKeys = new Set(["once", "signal"]);
    validateOptionKeys(options, allowedKeys, "subscription");

    const signal = validateSignal(readOwnValue(options, "signal", null));
    return this.on(eventName, listener, { once: true, signal });
  }

  /** Alias for on('*', listener). */
  onAny(listener, options = {}) {
    return this.on("*", listener, options);
  }

  /** Remove all registrations of a listener for the given event. */
  off(eventName, listener) {
    validateEventName(eventName, { allowWildcard: true });

    if (typeof listener !== "function") {
      throw new TypeError("Event listener must be a function.");
    }

    const entries = this.#listeners.get(eventName);

    if (!entries) {
      return 0;
    }

    let removed = 0;

    for (const record of [...entries]) {
      if (record.listener === listener && this.#removeRecord(eventName, record)) {
        removed += 1;
      }
    }

    return removed;
  }

  /** Emit an event without awaiting asynchronous listeners. */
  emit(eventName, payload = null, options = {}) {
    this.#assertActive();
    const event = this.#createEvent(eventName, payload, options);
    const records = this.#snapshotListeners(eventName);
    const errors = [];
    let delivered = 0;

    for (const entry of records) {
      const { record, eventName: subscribedEventName } = entry;

      if (!record.active) {
        continue;
      }

      if (record.once) {
        this.#removeRecord(subscribedEventName, record);
      }

      delivered += 1;

      try {
        const result = record.listener(event);

        if (result && typeof result.then === "function") {
          // Prevent unhandled rejections. Use emitAsync() when listeners
          // need to perform asynchronous work or report async failures.
          Promise.resolve(result).catch(() => {});
          errors.push({
            listenerId: record.id,
            code: "ASYNC_LISTENER_NOT_AWAITED",
            message: "An asynchronous listener was used with emit(); use emitAsync() to await it.",
          });
        }
      } catch (error) {
        errors.push({
          listenerId: record.id,
          code: "LISTENER_FAILED",
          ...describeError(error),
        });
      }
    }

    return Object.freeze({
      event,
      delivered,
      errors: Object.freeze(errors),
    });
  }

  /** Emit an event and await listeners sequentially in subscription order. */
  async emitAsync(eventName, payload = null, options = {}) {
    this.#assertActive();
    const event = this.#createEvent(eventName, payload, options);
    const records = this.#snapshotListeners(eventName);
    const errors = [];
    let delivered = 0;

    for (const entry of records) {
      const { record, eventName: subscribedEventName } = entry;

      if (!record.active) {
        continue;
      }

      if (record.once) {
        this.#removeRecord(subscribedEventName, record);
      }

      delivered += 1;

      try {
        await record.listener(event);
      } catch (error) {
        errors.push({
          listenerId: record.id,
          code: "LISTENER_FAILED",
          ...describeError(error),
        });
      }
    }

    return Object.freeze({
      event,
      delivered,
      errors: Object.freeze(errors),
    });
  }

  /** Return the number of active listeners for one event or the whole bus. */
  listenerCount(eventName = null) {
    if (eventName === null) {
      let total = 0;

      for (const entries of this.#listeners.values()) {
        total += entries.filter((record) => record.active).length;
      }

      return total;
    }

    validateEventName(eventName, { allowWildcard: true });
    return (this.#listeners.get(eventName) ?? [])
      .filter((record) => record.active).length;
  }

  /** Return event names that currently have active listeners. */
  eventNames() {
    return [...this.#listeners.entries()]
      .filter(([, entries]) => entries.some((record) => record.active))
      .map(([eventName]) => eventName);
  }

  /** Remove all listeners for one event, or every listener when omitted. */
  removeAllListeners(eventName = null) {
    if (eventName !== null) {
      validateEventName(eventName, { allowWildcard: true });
      const entries = this.#listeners.get(eventName) ?? [];
      let removed = 0;

      for (const record of [...entries]) {
        if (this.#removeRecord(eventName, record)) {
          removed += 1;
        }
      }

      return removed;
    }

    let removed = 0;

    for (const [name, entries] of [...this.#listeners.entries()]) {
      for (const record of [...entries]) {
        if (this.#removeRecord(name, record)) {
          removed += 1;
        }
      }
    }

    return removed;
  }

  /** Remove listeners while keeping the bus available for future subscriptions. */
  clear() {
    return this.removeAllListeners();
  }

  /** Remove listeners and permanently close this event bus instance. */
  dispose() {
    if (this.#disposed) {
      return false;
    }

    this.removeAllListeners();
    this.#disposed = true;
    return true;
  }

  #createEvent(eventName, payload, options) {
    validateEventName(eventName);

    if (!Number.isSafeInteger(this.#eventSequence + 1)) {
      throw new RangeError("Event sequence limit has been reached.");
    }

    const normalizedOptions = normalizeEventOptions(options);

    return Object.freeze({
      sequence: ++this.#eventSequence,
      name: eventName,
      timestamp: new Date().toISOString(),
      source: normalizedOptions.source,
      executionId: normalizedOptions.executionId,
      payload,
      metadata: normalizedOptions.metadata,
    });
  }

  #snapshotListeners(eventName) {
    const direct = this.#listeners.get(eventName) ?? [];
    const wildcard = this.#listeners.get("*") ?? [];

    return [
      ...direct.map((record) => ({ record, eventName })),
      ...wildcard.map((record) => ({ record, eventName: "*" })),
    ];
  }

  #removeRecord(eventName, record) {
    if (!record.active) {
      return false;
    }

    record.active = false;

    if (record.signal && record.abortHandler) {
      record.signal.removeEventListener("abort", record.abortHandler);
    }

    const entries = this.#listeners.get(eventName);

    if (!entries) {
      return true;
    }

    const index = entries.indexOf(record);

    if (index !== -1) {
      entries.splice(index, 1);
    }

    if (entries.length === 0) {
      this.#listeners.delete(eventName);
    }

    return true;
  }

  #assertActive() {
    if (this.#disposed) {
      throw new Error("This EngineEventBus has been disposed.");
    }
  }
}

/** Shared application-level event bus. */
export const engineEvents = new EngineEventBus();
  
