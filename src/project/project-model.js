
/**
 * ToonForge — Project Model
 *
 * Defines the canonical, serializable data model
 * for ToonForge creative projects.
 */

export const PROJECT_SCHEMA_VERSION = 1;

export const DEFAULT_PROJECT_SETTINGS = Object.freeze({
  width: 1280,
  height: 720,
  fps: 24,
  aspectRatio: "16:9",
});

const RESERVED_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const MAX_DATA_DEPTH = 64;

let projectIdCounter = 0;

function createProjectError(code, message, path = "project") {
  const error = new TypeError(`${message} Path: ${path}.`);
  error.code = code;
  error.path = path;
  return error;
}

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

function createProjectId() {
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `project_${globalThis.crypto.randomUUID()}`;
  }

  projectIdCounter += 1;

  return [
    "project",
    Date.now().toString(36),
    projectIdCounter.toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join("_");
}

function createTimestamp() {
  return new Date().toISOString();
}

function assertSafeData(
  value,
  path = "project",
  ancestors = new WeakSet(),
  depth = 0
) {
  if (depth > MAX_DATA_DEPTH) {
    throw createProjectError(
      "MAX_DEPTH_EXCEEDED",
      "Project data exceeds the maximum nesting depth",
      path
    );
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createProjectError(
        "INVALID_NUMBER",
        "Project data must contain finite numbers",
        path
      );
    }

    return;
  }

  if (typeof value !== "object") {
    throw createProjectError(
      "UNSUPPORTED_DATA_TYPE",
      "Project data contains an unsupported value",
      path
    );
  }

  if (ancestors.has(value)) {
    throw createProjectError(
      "CIRCULAR_DATA",
      "Circular references are not allowed",
      path
    );
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw createProjectError(
          "SPARSE_ARRAY",
          "Sparse arrays are not allowed",
          `${path}[${index}]`
        );
      }

      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index)
      );

      if (
        !descriptor ||
        !Object.prototype.hasOwnProperty.call(
          descriptor,
          "value"
        )
      ) {
        throw createProjectError(
          "ACCESSOR_NOT_ALLOWED",
          "Accessor properties are not allowed",
          `${path}[${index}]`
        );
      }

      assertSafeData(
        descriptor.value,
        `${path}[${index}]`,
        ancestors,
        depth + 1
      );
    }

    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") {
        continue;
      }

      if (
        typeof key !== "string" ||
        !/^(0|[1-9]\d*)$/.test(key) ||
        Number(key) >= value.length
      ) {
        throw createProjectError(
          "INVALID_ARRAY_PROPERTY",
          "Arrays cannot contain additional properties",
          path
        );
      }
    }

    ancestors.delete(value);
    return;
  }

  if (!isPlainObject(value)) {
    throw createProjectError(
      "INVALID_OBJECT",
      "Project data must contain plain objects",
      path
    );
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || RESERVED_KEYS.has(key)) {
      throw createProjectError(
        "INVALID_PROPERTY",
        "Project data contains an invalid property",
        path
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      value,
      key
    );

    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      throw createProjectError(
        "ACCESSOR_NOT_ALLOWED",
        "Accessor properties are not allowed",
        `${path}.${key}`
      );
    }

    assertSafeData(
      descriptor.value,
      `${path}.${key}`,
      ancestors,
      depth + 1
    );
  }

  ancestors.delete(value);
}

function cloneData(value) {
  assertSafeData(value);

  return JSON.parse(JSON.stringify(value));
}

function requireString(value, path, options = {}) {
  const {
    allowEmpty = false,
    maxLength = 10000,
  } = options;

  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maxLength
  ) {
    throw createProjectError(
      "INVALID_STRING",
      "Expected a valid string",
      path
    );
  }
}

function requireTimestamp(value, path) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw createProjectError(
      "INVALID_TIMESTAMP",
      "Expected a valid ISO-compatible timestamp",
      path
    );
  }
}

function validateSettings(settings) {
  if (!isPlainObject(settings)) {
    throw createProjectError(
      "INVALID_SETTINGS",
      "Project settings must be an object",
      "project.settings"
    );
  }

  const allowedKeys = new Set([
    "width",
    "height",
    "fps",
    "aspectRatio",
  ]);

  for (const key of Object.keys(settings)) {
    if (!allowedKeys.has(key)) {
      throw createProjectError(
        "UNKNOWN_SETTING",
        "Unknown project setting",
        `project.settings.${key}`
      );
    }
  }

  for (const key of ["width", "height"]) {
    const value = settings[key];

    if (
      !Number.isSafeInteger(value) ||
      value < 16 ||
      value > 16384
    ) {
      throw createProjectError(
        "INVALID_SETTING",
        "Project dimensions must be integers from 16 to 16384",
        `project.settings.${key}`
      );
    }
  }

  if (
    !Number.isSafeInteger(settings.fps) ||
    settings.fps < 1 ||
    settings.fps > 120
  ) {
    throw createProjectError(
      "INVALID_SETTING",
      "Project FPS must be an integer from 1 to 120",
      "project.settings.fps"
    );
  }

  requireString(
    settings.aspectRatio,
    "project.settings.aspectRatio",
    { maxLength: 20 }
  );
}

function validateUniqueItems(items, path) {
  if (!Array.isArray(items)) {
    throw createProjectError(
      "INVALID_COLLECTION",
      "Expected an array",
      path
    );
  }

  const ids = new Set();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemPath = `${path}[${index}]`;

    if (!isPlainObject(item)) {
      throw createProjectError(
        "INVALID_ITEM",
        "Collection items must be plain objects",
        itemPath
      );
    }

    requireString(item.id, `${itemPath}.id`, {
      maxLength: 200,
    });

    if (ids.has(item.id)) {
      throw createProjectError(
        "DUPLICATE_ITEM_ID",
        "Collection item IDs must be unique",
        `${itemPath}.id`
      );
    }

    ids.add(item.id);
  }
}

/**
 * Validate a complete project document.
 *
 * @param {object} project
 * @returns {{valid: boolean, errors: Array}}
 */
export function validateProject(project) {
  try {
    assertSafeData(project);

    if (!isPlainObject(project)) {
      throw createProjectError(
        "INVALID_PROJECT",
        "Project must be a plain object"
      );
    }

    const requiredKeys = [
      "id",
      "schemaVersion",
      "name",
      "description",
      "createdAt",
      "updatedAt",
      "settings",
      "scenes",
      "assets",
      "metadata",
    ];

    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(project, key)) {
        throw createProjectError(
          "MISSING_PROPERTY",
          "Required project property is missing",
          `project.${key}`
        );
      }
    }

    const allowedKeys = new Set(requiredKeys);

    for (const key of Object.keys(project)) {
      if (!allowedKeys.has(key)) {
        throw createProjectError(
          "UNKNOWN_PROPERTY",
          "Unknown project property",
          `project.${key}`
        );
      }
    }

    requireString(project.id, "project.id", {
      maxLength: 200,
    });

    if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      throw createProjectError(
        "UNSUPPORTED_SCHEMA_VERSION",
        "Unsupported project schema version",
        "project.schemaVersion"
      );
    }

    requireString(project.name, "project.name", {
      maxLength: 200,
    });

    requireString(project.description, "project.description", {
      allowEmpty: true,
      maxLength: 10000,
    });

    requireTimestamp(project.createdAt, "project.createdAt");
    requireTimestamp(project.updatedAt, "project.updatedAt");

    validateSettings(project.settings);
    validateUniqueItems(project.scenes, "project.scenes");
    validateUniqueItems(project.assets, "project.assets");

    if (!isPlainObject(project.metadata)) {
      throw createProjectError(
        "INVALID_METADATA",
        "Project metadata must be a plain object",
        "project.metadata"
      );
    }

    return {
      valid: true,
      errors: [],
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          code: error.code ?? "PROJECT_VALIDATION_ERROR",
          path: error.path ?? "project",
          message: error.message,
        },
      ],
    };
  }
}

/**
 * Create a new ToonForge project document.
 *
 * @param {object} options
 * @returns {object}
 */
export function createProject(options = {}) {
  if (!isPlainObject(options)) {
    throw createProjectError(
      "INVALID_OPTIONS",
      "Project options must be a plain object",
      "options"
    );
  }

  const allowedOptions = new Set([
    "id",
    "name",
    "description",
    "settings",
    "scenes",
    "assets",
    "metadata",
  ]);

  for (const key of Reflect.ownKeys(options)) {
    if (
      typeof key !== "string" ||
      !allowedOptions.has(key)
    ) {
      throw createProjectError(
        "UNKNOWN_OPTION",
        "Unknown project creation option",
        `options.${String(key)}`
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      options,
      key
    );

    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      throw createProjectError(
        "ACCESSOR_NOT_ALLOWED",
        "Accessor properties are not allowed",
        `options.${key}`
      );
    }
  }

  const timestamp = createTimestamp();

  const project = {
    id: options.id ?? createProjectId(),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: options.name ?? "Untitled Project",
    description: options.description ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      ...(options.settings ?? {}),
    },
    scenes: cloneData(options.scenes ?? []),
    assets: cloneData(options.assets ?? []),
    metadata: cloneData(options.metadata ?? {}),
  };

  const result = validateProject(project);

  if (!result.valid) {
    const firstError = result.errors[0];

    throw createProjectError(
      firstError.code,
      firstError.message,
      firstError.path
    );
  }

  return cloneData(project);
}

/**
 * Serialize a valid project into JSON.
 *
 * @param {object} project
 * @returns {string}
 */
export function serializeProject(project) {
  const result = validateProject(project);

  if (!result.valid) {
    const firstError = result.errors[0];

    throw createProjectError(
      firstError.code,
      firstError.message,
      firstError.path
    );
  }

  return JSON.stringify(project, null, 2);
}

/**
 * Restore a project from a JSON string.
 *
 * @param {string} json
 * @returns {object}
 */
export function deserializeProject(json) {
  if (typeof json !== "string") {
    throw createProjectError(
      "INVALID_JSON_INPUT",
      "Serialized project must be a string",
      "json"
    );
  }

  let project;

  try {
    project = JSON.parse(json);
  } catch (error) {
    throw createProjectError(
      "INVALID_JSON",
      "Unable to parse project JSON",
      "json"
    );
  }

  const result = validateProject(project);

  if (!result.valid) {
    const firstError = result.errors[0];

    throw createProjectError(
      firstError.code,
      firstError.message,
      firstError.path
    );
  }

  return cloneData(project);
}

/**
 * Create an updated project document.
 *
 * Identity and creation timestamp are immutable.
 *
 * @param {object} project
 * @param {object} changes
 * @returns {object}
 */
export function updateProject(project, changes = {}) {
  const originalResult = validateProject(project);

  if (!originalResult.valid) {
    throw createProjectError(
      "INVALID_SOURCE_PROJECT",
      "Cannot update an invalid project",
      "project"
    );
  }

  if (!isPlainObject(changes)) {
    throw createProjectError(
      "INVALID_CHANGES",
      "Project changes must be a plain object",
      "changes"
    );
  }

  const allowedChanges = new Set([
    "name",
    "description",
    "settings",
    "scenes",
    "assets",
    "metadata",
  ]);

  for (const key of Reflect.ownKeys(changes)) {
    if (
      typeof key !== "string" ||
      !allowedChanges.has(key)
    ) {
      throw createProjectError(
        "IMMUTABLE_OR_UNKNOWN_PROPERTY",
        "Unknown or immutable project property",
        `changes.${String(key)}`
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      changes,
      key
    );

    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      throw createProjectError(
        "ACCESSOR_NOT_ALLOWED",
        "Accessor properties are not allowed",
        `changes.${key}`
      );
    }
  }

  const updated = {
    ...cloneData(project),
    ...cloneData(changes),
    updatedAt: createTimestamp(),
  };

  const result = validateProject(updated);

  if (!result.valid) {
    const firstError = result.errors[0];

    throw createProjectError(
      firstError.code,
      firstError.message,
      firstError.path
    );
  }

  return cloneData(updated);
    }
      
