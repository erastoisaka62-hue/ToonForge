/**
 * ToonForge — Core Engine Configuration
 *
 * Provides centralized, validated and immutable
 * configuration for the ToonForge engine system.
 *
 * Features:
 * - Centralized engine configuration.
 * - Safe nested configuration overrides.
 * - Strict configuration validation.
 * - Protection against accessor properties.
 * - Protection against unknown configuration keys.
 * - Deeply immutable configuration snapshots.
 */

const DEFAULT_CONFIG = {
  runtime: {
    maxPipelineSteps: 2000,
    maxConcurrentTasks: 1,
    executionTimeoutMs: 0,
  },

  validation: {
    maxDepth: 32,
    rejectUnknownProperties: false,
  },

  rendering: {
    defaultWidth: 1280,
    defaultHeight: 720,
    defaultFps: 24,
    quality: "preview",
    format: "webgl",
  },

  storage: {
    projectDirectory: "projects",
    assetDirectory: "assets",
    autosave: true,
    autosaveIntervalMs: 60000,
  },

  logging: {
    enabled: true,
    maxEventEntries: 1000,
    level: "info",
  },
};

const ALLOWED_QUALITY = new Set([
  "draft",
  "preview",
  "standard",
  "high",
  "ultra",
]);

const ALLOWED_RENDER_FORMATS = new Set([
  "webgl",
  "webgpu",
]);

const ALLOWED_LOG_LEVELS = new Set([
  "debug",
  "info",
  "warn",
  "error",
]);

const CONFIGURATION_ERRORS = {
  INVALID_CONFIG:
    "Configuration must be a plain object.",

  UNKNOWN_KEY:
    "Unknown configuration property.",

  INVALID_VALUE:
    "Invalid configuration value.",

  ACCESSOR_NOT_ALLOWED:
    "Accessor properties are not allowed in configuration.",

  INVALID_NESTED_CONFIG:
    "Nested configuration must be a plain object.",
};

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

function createConfigError(code, path, message) {
  const error = new TypeError(
    `${message} Path: ${path}.`
  );

  error.code = code;
  error.path = path;

  return error;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    seen.has(value)
  ) {
    return value;
  }

  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(
      value,
      key
    );

    if (
      descriptor &&
      Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      deepFreeze(descriptor.value, seen);
    }
  }

  return Object.freeze(value);
}

function cloneDefaultConfig() {
  return {
    runtime: {
      ...DEFAULT_CONFIG.runtime,
    },

    validation: {
      ...DEFAULT_CONFIG.validation,
    },

    rendering: {
      ...DEFAULT_CONFIG.rendering,
    },

    storage: {
      ...DEFAULT_CONFIG.storage,
    },

    logging: {
      ...DEFAULT_CONFIG.logging,
    },
  };
}

function mergeConfiguration(target, overrides, path = "config") {
  if (!isPlainObject(overrides)) {
    throw createConfigError(
      "INVALID_CONFIG",
      path,
      CONFIGURATION_ERRORS.INVALID_CONFIG
    );
  }

  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== "string") {
      throw createConfigError(
        "UNKNOWN_KEY",
        path,
        CONFIGURATION_ERRORS.UNKNOWN_KEY
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      overrides,
      key
    );

    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      throw createConfigError(
        "ACCESSOR_NOT_ALLOWED",
        `${path}.${key}`,
        CONFIGURATION_ERRORS.ACCESSOR_NOT_ALLOWED
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        target,
        key
      )
    ) {
      throw createConfigError(
        "UNKNOWN_KEY",
        `${path}.${key}`,
        CONFIGURATION_ERRORS.UNKNOWN_KEY
      );
    }

    const currentValue = target[key];
    const overrideValue = descriptor.value;

    if (isPlainObject(currentValue)) {
      if (!isPlainObject(overrideValue)) {
        throw createConfigError(
          "INVALID_NESTED_CONFIG",
          `${path}.${key}`,
          CONFIGURATION_ERRORS.INVALID_NESTED_CONFIG
        );
      }

      mergeConfiguration(
        currentValue,
        overrideValue,
        `${path}.${key}`
      );

      continue;
    }

    if (
      isPlainObject(overrideValue) ||
      Array.isArray(overrideValue)
    ) {
      throw createConfigError(
        "INVALID_VALUE",
        `${path}.${key}`,
        CONFIGURATION_ERRORS.INVALID_VALUE
      );
    }

    target[key] = overrideValue;
  }

  return target;
}

function requireInteger(value, path, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw createConfigError(
      "INVALID_VALUE",
      path,
      `Expected an integer between ${minimum} and ${maximum}`
    );
  }
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw createConfigError(
      "INVALID_VALUE",
      path,
      "Expected a boolean"
    );
  }
}

function requireNonEmptyString(value, path) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim() !== value
  ) {
    throw createConfigError(
      "INVALID_VALUE",
      path,
      "Expected a non-empty string without surrounding whitespace"
    );
  }
}

function validateConfiguration(config) {
  requireInteger(
    config.runtime.maxPipelineSteps,
    "runtime.maxPipelineSteps",
    1,
    10000
  );

  requireInteger(
    config.runtime.maxConcurrentTasks,
    "runtime.maxConcurrentTasks",
    1,
    64
  );

  requireInteger(
    config.runtime.executionTimeoutMs,
    "runtime.executionTimeoutMs",
    0,
    Number.MAX_SAFE_INTEGER
  );

  requireInteger(
    config.validation.maxDepth,
    "validation.maxDepth",
    1,
    128
  );

  requireBoolean(
    config.validation.rejectUnknownProperties,
    "validation.rejectUnknownProperties"
  );

  requireInteger(
    config.rendering.defaultWidth,
    "rendering.defaultWidth",
    16,
    16384
  );

  requireInteger(
    config.rendering.defaultHeight,
    "rendering.defaultHeight",
    16,
    16384
  );

  requireInteger(
    config.rendering.defaultFps,
    "rendering.defaultFps",
    1,
    120
  );

  if (!ALLOWED_QUALITY.has(config.rendering.quality)) {
    throw createConfigError(
      "INVALID_VALUE",
      "rendering.quality",
      "Unsupported rendering quality"
    );
  }

  if (
    !ALLOWED_RENDER_FORMATS.has(
      config.rendering.format
    )
  ) {
    throw createConfigError(
      "INVALID_VALUE",
      "rendering.format",
      "Unsupported rendering format"
    );
  }

  requireNonEmptyString(
    config.storage.projectDirectory,
    "storage.projectDirectory"
  );

  requireNonEmptyString(
    config.storage.assetDirectory,
    "storage.assetDirectory"
  );

  requireBoolean(
    config.storage.autosave,
    "storage.autosave"
  );

  requireInteger(
    config.storage.autosaveIntervalMs,
    "storage.autosaveIntervalMs",
    1000,
    Number.MAX_SAFE_INTEGER
  );

  requireBoolean(
    config.logging.enabled,
    "logging.enabled"
  );

  requireInteger(
    config.logging.maxEventEntries,
    "logging.maxEventEntries",
    1,
    100000
  );

  if (!ALLOWED_LOG_LEVELS.has(config.logging.level)) {
    throw createConfigError(
      "INVALID_VALUE",
      "logging.level",
      "Unsupported logging level"
    );
  }

  return true;
}

/**
 * Create a new independent engine configuration.
 *
 * @param {object} overrides
 * @returns {Readonly<object>}
 */
export function createEngineConfig(overrides = {}) {
  const config = cloneDefaultConfig();

  mergeConfiguration(
    config,
    overrides
  );

  validateConfiguration(config);

  return deepFreeze(config);
}

/**
 * Default immutable engine configuration.
 */
export const DEFAULT_ENGINE_CONFIG = deepFreeze(
  cloneDefaultConfig()
);

/**
 * Shared application-level engine configuration.
 */
export const engineConfig = DEFAULT_ENGINE_CONFIG;

/**
 * Return a configuration snapshot.
 *
 * The returned object is immutable.
 */
export function getEngineConfig() {
  return engineConfig;
}

/**
 * Check whether a configuration is valid.
 *
 * Returns a structured result instead of throwing.
 */
export function validateEngineConfig(config) {
  try {
    const normalized = createEngineConfig(config);

    return {
      valid: true,
      errors: [],
      config: normalized,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          code: error.code ?? "CONFIGURATION_ERROR",
          path: error.path ?? "config",
          message: error.message,
        },
      ],
    };
  }
}
