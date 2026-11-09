
/**
 * ToonForge — Engine Context
 *
 * Provides shared, execution-scoped information and utilities
 * to production engines during a project or scene workflow.
 *
 * Runtime values stored with setData() are intentionally kept
 * in memory. They are not a substitute for project-file storage.
 */

import { EngineError } from "./engine-base.js";

const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

let executionSequence = 0;

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotRecord(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isPlainRecord(value)) {
    throw new TypeError(`${label} must be a plain object or null.`);
  }

  // Shallow snapshot: nested runtime resources remain referenced.
  return Object.freeze({ ...value });
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function createExecutionId() {
  executionSequence += 1;
  return `exec-${Date.now()}-${executionSequence}`;
}

function snapshotDetails(details) {
  if (details === null || details === undefined) {
    return null;
  }

  return isPlainRecord(details)
    ? Object.freeze({ ...details })
    : details;
}

/**
 * Shared context for one project or scene execution workflow.
 */
export class EngineContext {
  #signal;
  #sharedData;
  #events;
  #eventSequence;
  #maxEventEntries;
  #progress;

  constructor({
    project = null,
    scene = null,
    executionId = null,
    parentExecutionId = null,
    metadata = {},
    signal = null,
    maxEventEntries = 1000,
  } = {}) {
    if (
      signal !== null &&
      (typeof signal !== "object" || typeof signal.aborted !== "boolean")
    ) {
      throw new TypeError(
        "signal must be an AbortSignal-compatible object or null."
      );
    }

    if (
      !Number.isSafeInteger(maxEventEntries) ||
      maxEventEntries < 1 ||
      maxEventEntries > 10000
    ) {
      throw new RangeError(
        "maxEventEntries must be an integer between 1 and 10000."
      );
    }

    const resolvedExecutionId = executionId === null
      ? createExecutionId()
      : requireNonEmptyString(executionId, "executionId");

    const resolvedParentExecutionId = parentExecutionId === null
      ? null
      : requireNonEmptyString(parentExecutionId, "parentExecutionId");

    Object.defineProperties(this, {
      project: {
        value: snapshotRecord(project, "project"),
        enumerable: true,
      },
      scene: {
        value: snapshotRecord(scene, "scene"),
        enumerable: true,
      },
      executionId: {
        value: resolvedExecutionId,
        enumerable: true,
      },
      parentExecutionId: {
        value: resolvedParentExecutionId,
        enumerable: true,
      },
      metadata: {
        value: snapshotRecord(metadata, "metadata") ?? Object.freeze({}),
        enumerable: true,
      },
      createdAt: {
        value: new Date().toISOString(),
        enumerable: true,
      },
    });

    this.#signal = signal;
    this.#sharedData = new Map();
    this.#events = [];
    this.#eventSequence = 0;
    this.#maxEventEntries = maxEventEntries;
    this.#progress = Object.freeze({
      value: 0,
      message: "",
      updatedAt: this.createdAt,
    });
  }

  /** Returns the optional cancellation signal. */
  get signal() {
    return this.#signal;
  }

  /** Returns a read-only snapshot of execution progress. */
  get progress() {
    return { ...this.#progress };
  }

  /** Returns true when the execution has been cancelled. */
  get isAborted() {
    return this.#signal?.aborted === true;
  }

  /**
   * Throws a standardized error when the workflow was cancelled.
   * Engines should call this between expensive or long-running steps.
   */
  throwIfAborted() {
    if (!this.isAborted) {
      return;
    }

    const reason = this.#signal?.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === "string" && reason.trim()
        ? reason
        : "Execution was cancelled.";

    throw new EngineError(message, {
      code: "EXECUTION_ABORTED",
      details: { reason: message },
      ...(reason instanceof Error ? { cause: reason } : {}),
    });
  }

  /**
   * Store an in-memory value under an engine namespace and key.
   * Values may be runtime objects such as 3D meshes or audio buffers.
   */
  setData(namespace, key, value) {
    const safeNamespace = requireNonEmptyString(namespace, "namespace");
    const safeKey = requireNonEmptyString(key, "key");

    let namespaceData = this.#sharedData.get(safeNamespace);

    if (!namespaceData) {
      namespaceData = new Map();
      this.#sharedData.set(safeNamespace, namespaceData);
    }

    namespaceData.set(safeKey, value);
    return value;
  }

  /** Retrieve a shared value, or return the supplied fallback. */
  getData(namespace, key, fallback = undefined) {
    const safeNamespace = requireNonEmptyString(namespace, "namespace");
    const safeKey = requireNonEmptyString(key, "key");
    const namespaceData = this.#sharedData.get(safeNamespace);

    return namespaceData?.has(safeKey)
      ? namespaceData.get(safeKey)
      : fallback;
  }

  /** Check whether a shared value exists. */
  hasData(namespace, key) {
    const safeNamespace = requireNonEmptyString(namespace, "namespace");
    const safeKey = requireNonEmptyString(key, "key");
    return this.#sharedData.get(safeNamespace)?.has(safeKey) ?? false;
  }

  /** Delete one shared value and remove its empty namespace. */
  deleteData(namespace, key) {
    const safeNamespace = requireNonEmptyString(namespace, "namespace");
    const safeKey = requireNonEmptyString(key, "key");
    const namespaceData = this.#sharedData.get(safeNamespace);

    if (!namespaceData) {
      return false;
    }

    const deleted = namespaceData.delete(safeKey);

    if (namespaceData.size === 0) {
      this.#sharedData.delete(safeNamespace);
    }

    return deleted;
  }

  /** Return a defensive copy of a namespace's Map. */
  getNamespaceData(namespace) {
    const safeNamespace = requireNonEmptyString(namespace, "namespace");
    return new Map(this.#sharedData.get(safeNamespace) ?? []);
  }

  /** Clear one namespace, or all shared data when no namespace is supplied. */
  clearData(namespace = null) {
    if (namespace === null) {
      let removed = 0;

      for (const values of this.#sharedData.values()) {
        removed += values.size;
      }

      this.#sharedData.clear();
      return removed;
    }

    const safeNamespace = requireNonEmptyString(namespace, "namespace");
    const existing = this.#sharedData.get(safeNamespace);

    if (!existing) {
      return 0;
    }

    const removed = existing.size;
    this.#sharedData.delete(safeNamespace);
    return removed;
  }

  /** Add a structured log event to the execution context. */
  log(level, message, details = null) {
    if (!LOG_LEVELS.has(level)) {
      throw new TypeError(`Unsupported log level: ${String(level)}.`);
    }

    if (typeof message !== "string" || message.trim().length === 0) {
      throw new TypeError("Log message must be a non-empty string.");
    }

    return this.#appendEvent({
      type: "log",
      level,
      message: message.trim(),
      details: snapshotDetails(details),
    });
  }

  /** Report workflow progress from 0 to 100 percent. */
  reportProgress(value, message = "") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new RangeError(
        "Progress value must be a finite number between 0 and 100."
      );
    }

    if (typeof message !== "string") {
      throw new TypeError("Progress message must be a string.");
    }

    const updatedAt = new Date().toISOString();

    this.#progress = Object.freeze({
      value,
      message: message.trim(),
      updatedAt,
    });

    this.#appendEvent({
      type: "progress",
      value,
      message: message.trim(),
    });

    return this.progress;
  }

  /** Return retained events, optionally filtered by type and sequence. */
  getEvents({ type = null, sinceSequence = 0 } = {}) {
    if (
      !Number.isSafeInteger(sinceSequence) ||
      sinceSequence < 0
    ) {
      throw new RangeError(
        "sinceSequence must be a non-negative safe integer."
      );
    }

    if (type !== null && typeof type !== "string") {
      throw new TypeError("Event type must be a string or null.");
    }

    return this.#events
      .filter((event) =>
        event.sequence > sinceSequence &&
        (type === null || event.type === type)
      )
      .map((event) => ({ ...event }));
  }

  /** Return retained log entries only. */
  getLogs(options = {}) {
    return this.getEvents({ ...options, type: "log" });
  }

  /** Remove retained logs and progress events without resetting sequence IDs. */
  clearEvents() {
    const removed = this.#events.length;
    this.#events = [];
    return removed;
  }

  /** Return a serializable summary of the context metadata. */
  getInfo() {
    return Object.freeze({
      executionId: this.executionId,
      parentExecutionId: this.parentExecutionId,
      projectId: this.project?.id ?? this.project?.projectId ?? null,
      sceneId: this.scene?.id ?? this.scene?.sceneId ?? null,
      createdAt: this.createdAt,
      progress: this.progress,
      isAborted: this.isAborted,
      metadata: { ...this.metadata },
    });
  }

  #appendEvent(eventData) {
    const event = Object.freeze({
      sequence: ++this.#eventSequence,
      executionId: this.executionId,
      timestamp: new Date().toISOString(),
      ...eventData,
    });

    this.#events.push(event);

    if (this.#events.length > this.#maxEventEntries) {
      this.#events.splice(
        0,
        this.#events.length - this.#maxEventEntries
      );
    }

    return { ...event };
  }
      }
      
