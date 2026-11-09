
/**
 * ToonForge — Engine Validator
 *
 * Provides reusable schema validation for production engines,
 * project data, scene data and other execution inputs.
 *
 * This module has no external dependencies.
 */

import {
  EngineBase,
  EngineError,
  ENGINE_STATES,
} from "./engine-base.js";

const SUPPORTED_TYPES = new Set([
  "any",
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
]);

const RESERVED_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const SCHEMA_KEYS = new Set([
  "type",
  "nullable",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "min",
  "max",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
]);

const ENGINE_INFO_SCHEMA = {
  type: "object",
  required: [
    "id",
    "name",
    "version",
    "description",
    "status",
  ],
  properties: {
    id: {
      type: "string",
      minLength: 1,
    },
    name: {
      type: "string",
      minLength: 1,
    },
    version: {
      type: "string",
      minLength: 1,
    },
    description: {
      type: "string",
    },
    status: {
      type: "string",
      enum: Object.values(ENGINE_STATES),
    },
  },
  additionalProperties: false,
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

function isReservedKey(key) {
  return RESERVED_KEYS.has(key);
}

function isScalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function createError(path, code, message, details = {}) {
  return {
    path,
    code,
    message,
    ...details,
  };
}

/**
 * Normalize and freeze a schema.
 * Invalid schemas are rejected before validation begins.
 */
function normalizeSchema(
  schema,
  path = "$schema",
  stack = new WeakSet(),
  depth = 0,
  maxDepth = 32
) {
  if (depth > maxDepth) {
    throw new TypeError(
      `Schema nesting exceeds the maximum depth at ${path}.`
    );
  }

  if (!isPlainObject(schema)) {
    throw new TypeError(
      `Schema at ${path} must be a plain object.`
    );
  }

  if (stack.has(schema)) {
    throw new TypeError(
      `Circular schema definition detected at ${path}.`
    );
  }

  stack.add(schema);

  try {
    for (const key of Object.keys(schema)) {
      if (!SCHEMA_KEYS.has(key)) {
        throw new TypeError(
          `Unknown schema option "${key}" at ${path}.`
        );
      }
    }

    const type = schema.type ?? "any";

    if (!SUPPORTED_TYPES.has(type)) {
      throw new TypeError(
        `Unsupported schema type "${String(type)}" at ${path}.`
      );
    }

    const nullable = schema.nullable ?? false;

    if (typeof nullable !== "boolean") {
      throw new TypeError(
        `Schema nullable must be a boolean at ${path}.`
      );
    }

    const normalized = {
      type,
      nullable,
    };

    if (schema.enum !== undefined) {
      if (
        !Array.isArray(schema.enum) ||
        !schema.enum.every(isScalar)
      ) {
        throw new TypeError(
          `Schema enum must contain only scalar values at ${path}.`
        );
      }

      normalized.enum = Object.freeze([...schema.enum]);
    }

    if (schema.required !== undefined) {
      if (
        type !== "object" ||
        !Array.isArray(schema.required) ||
        !schema.required.every(
          (key) => typeof key === "string" && key.length > 0
        )
      ) {
        throw new TypeError(
          `Invalid required fields at ${path}.`
        );
      }

      if (new Set(schema.required).size !== schema.required.length) {
        throw new TypeError(
          `Duplicate required fields at ${path}.`
        );
      }

      if (schema.required.some(isReservedKey)) {
        throw new TypeError(
          `Reserved property names are not allowed at ${path}.`
        );
      }

      normalized.required = Object.freeze([
        ...schema.required,
      ]);
    }

    if (schema.properties !== undefined) {
      if (
        type !== "object" ||
        !isPlainObject(schema.properties)
      ) {
        throw new TypeError(
          `Schema properties must be an object at ${path}.`
        );
      }

      const properties = Object.create(null);

      for (const [key, propertySchema] of Object.entries(
        schema.properties
      )) {
        if (isReservedKey(key)) {
          throw new TypeError(
            `Reserved property name "${key}" at ${path}.`
          );
        }

        properties[key] = normalizeSchema(
          propertySchema,
          `${path}.properties.${key}`,
          stack,
          depth + 1,
          maxDepth
        );
      }

      normalized.properties = Object.freeze(properties);
    }

    if (schema.additionalProperties !== undefined) {
      if (
        type !== "object" ||
        typeof schema.additionalProperties !== "boolean"
      ) {
        throw new TypeError(
          `additionalProperties must be a boolean on object schemas at ${path}.`
        );
      }

      normalized.additionalProperties =
        schema.additionalProperties;
    }

    if (schema.items !== undefined) {
      if (type !== "array") {
        throw new TypeError(
          `Schema items can only be used with arrays at ${path}.`
        );
      }

      normalized.items = normalizeSchema(
        schema.items,
        `${path}.items`,
        stack,
        depth + 1,
        maxDepth
      );
    }

    const numericRules = ["min", "max"];
    const stringRules = [
      "minLength",
      "maxLength",
      "pattern",
    ];
    const arrayRules = ["minItems", "maxItems"];
    const objectRules = [
      "minProperties",
      "maxProperties",
    ];

    for (const rule of numericRules) {
      if (schema[rule] !== undefined) {
        if (
          !["number", "integer"].includes(type) ||
          typeof schema[rule] !== "number" ||
          !Number.isFinite(schema[rule])
        ) {
          throw new TypeError(
            `Invalid ${rule} constraint at ${path}.`
          );
        }

        normalized[rule] = schema[rule];
      }
    }

    for (const rule of stringRules) {
      if (schema[rule] === undefined) {
        continue;
      }

      if (type !== "string") {
        throw new TypeError(
          `${rule} can only be used with string schemas at ${path}.`
        );
      }

      if (rule === "pattern") {
        if (typeof schema.pattern !== "string") {
          throw new TypeError(
            `Pattern must be a string at ${path}.`
          );
        }

        try {
          new RegExp(schema.pattern);
        } catch {
          throw new TypeError(
            `Invalid regular expression pattern at ${path}.`
          );
        }

        normalized.pattern = schema.pattern;
      } else {
        if (
          !Number.isSafeInteger(schema[rule]) ||
          schema[rule] < 0
        ) {
          throw new TypeError(
            `${rule} must be a non-negative integer at ${path}.`
          );
        }

        normalized[rule] = schema[rule];
      }
    }

    for (const rule of arrayRules) {
      if (schema[rule] === undefined) {
        continue;
      }

      if (
        type !== "array" ||
        !Number.isSafeInteger(schema[rule]) ||
        schema[rule] < 0
      ) {
        throw new TypeError(
          `Invalid ${rule} constraint at ${path}.`
        );
      }

      normalized[rule] = schema[rule];
    }

    for (const rule of objectRules) {
      if (schema[rule] === undefined) {
        continue;
      }

      if (
        type !== "object" ||
        !Number.isSafeInteger(schema[rule]) ||
        schema[rule] < 0
      ) {
        throw new TypeError(
          `Invalid ${rule} constraint at ${path}.`
        );
      }

      normalized[rule] = schema[rule];
    }

    if (
      normalized.min !== undefined &&
      normalized.max !== undefined &&
      normalized.min > normalized.max
    ) {
      throw new TypeError(
        `Schema min cannot exceed max at ${path}.`
      );
    }

    if (
      normalized.minLength !== undefined &&
      normalized.maxLength !== undefined &&
      normalized.minLength > normalized.maxLength
    ) {
      throw new TypeError(
        `minLength cannot exceed maxLength at ${path}.`
      );
    }

    if (
      normalized.minItems !== undefined &&
      normalized.maxItems !== undefined &&
      normalized.minItems > normalized.maxItems
    ) {
      throw new TypeError(
        `minItems cannot exceed maxItems at ${path}.`
      );
    }

    if (
      normalized.minProperties !== undefined &&
      normalized.maxProperties !== undefined &&
      normalized.minProperties > normalized.maxProperties
    ) {
      throw new TypeError(
        `minProperties cannot exceed maxProperties at ${path}.`
      );
    }

    if (
      normalized.required &&
      normalized.properties
    ) {
      for (const key of normalized.required) {
        if (
          !Object.prototype.hasOwnProperty.call(
            normalized.properties,
            key
          )
        ) {
          // Required fields may intentionally have no property schema.
          // They are still checked for presence during validation.
        }
      }
    }

    return Object.freeze(normalized);
  } finally {
    stack.delete(schema);
  }
}

/**
 * Validate a value against a normalized schema.
 */
function validateValue(
  value,
  schema,
  path,
  errors,
  stack,
  depth,
  maxDepth
) {
  if (depth > maxDepth) {
    errors.push(
      createError(
        path,
        "MAX_DEPTH_EXCEEDED",
        "Value nesting exceeds the maximum allowed depth."
      )
    );
    return;
  }

  if (value === null) {
    const nullable =
      schema.nullable === true ||
      schema.enum?.includes(null) === true;

    if (!nullable) {
      errors.push(
        createError(
          path,
          "NULL_NOT_ALLOWED",
          "Null is not allowed for this value."
        )
      );
    }

    return;
  }

  if (
    schema.enum &&
    !schema.enum.some((entry) => Object.is(entry, value))
  ) {
    errors.push(
      createError(
        path,
        "ENUM_MISMATCH",
        "Value is not one of the allowed options.",
        { allowedValues: [...schema.enum] }
      )
    );
    return;
  }

  const type = schema.type;

  const typeIsValid = (() => {
    switch (type) {
      case "any":
        return true;

      case "string":
        return typeof value === "string";

      case "number":
        return (
          typeof value === "number" &&
          Number.isFinite(value)
        );

      case "integer":
        return (
          typeof value === "number" &&
          Number.isSafeInteger(value)
        );

      case "boolean":
        return typeof value === "boolean";

      case "object":
        return isPlainObject(value);

      case "array":
        return Array.isArray(value);

      default:
        return false;
    }
  })();

  if (!typeIsValid) {
    errors.push(
      createError(
        path,
        "TYPE_MISMATCH",
        `Expected ${type}, received ${Array.isArray(value) ? "array" : typeof value}.`,
        { expected: type }
      )
    );
    return;
  }

  if (type === "string") {
    const length = Array.from(value).length;

    if (
      schema.minLength !== undefined &&
      length < schema.minLength
    ) {
      errors.push(
        createError(
          path,
          "STRING_TOO_SHORT",
          `String must contain at least ${schema.minLength} characters.`
        )
      );
    }

    if (
      schema.maxLength !== undefined &&
      length > schema.maxLength
    ) {
      errors.push(
        createError(
          path,
          "STRING_TOO_LONG",
          `String must contain no more than ${schema.maxLength} characters.`
        )
      );
    }

    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern).test(value)
    ) {
      errors.push(
        createError(
          path,
          "PATTERN_MISMATCH",
          "String does not match the required pattern."
        )
      );
    }

    return;
  }

  if (type === "number" || type === "integer") {
    if (
      schema.min !== undefined &&
      value < schema.min
    ) {
      errors.push(
        createError(
          path,
          "NUMBER_TOO_SMALL",
          `Value must be at least ${schema.min}.`
        )
      );
    }

    if (
      schema.max !== undefined &&
      value > schema.max
    ) {
      errors.push(
        createError(
          path,
          "NUMBER_TOO_LARGE",
          `Value must be no greater than ${schema.max}.`
        )
      );
    }

    return;
  }

  if (type === "array") {
    if (
      schema.minItems !== undefined &&
      value.length < schema.minItems
    ) {
      errors.push(
        createError(
          path,
          "ARRAY_TOO_SHORT",
          `Array must contain at least ${schema.minItems} items.`
        )
      );
    }

    if (
      schema.maxItems !== undefined &&
      value.length > schema.maxItems
    ) {
      errors.push(
        createError(
          path,
          "ARRAY_TOO_LONG",
          `Array must contain no more than ${schema.maxItems} items.`
        )
      );
    }

    if (!schema.items) {
      return;
    }

    if (stack.has(value)) {
      errors.push(
        createError(
          path,
          "CIRCULAR_DATA",
          "Circular array reference detected."
        )
      );
      return;
    }

    stack.add(value);

    try {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index)
        );

        const itemPath = `${path}[${index}]`;

        if (!descriptor) {
          errors.push(
            createError(
              itemPath,
              "ARRAY_HOLE",
              "Sparse array entries are not allowed."
            )
          );
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
          errors.push(
            createError(
              itemPath,
              "ACCESSOR_NOT_ALLOWED",
              "Accessor properties are not allowed in validation data."
            )
          );
          continue;
        }

        validateValue(
          descriptor.value,
          schema.items,
          itemPath,
          errors,
          stack,
          depth + 1,
          maxDepth
        );
      }
    } finally {
      stack.delete(value);
    }

    return;
  }

  if (type === "object") {
    if (
      stack.has(value)
    ) {
      errors.push(
        createError(
          path,
          "CIRCULAR_DATA",
          "Circular object reference detected."
        )
      );
      return;
    }

    stack.add(value);

    try {
      const keys = Object.keys(value);

      if (
        schema.minProperties !== undefined &&
        keys.length < schema.minProperties
      ) {
        errors.push(
          createError(
            path,
            "TOO_FEW_PROPERTIES",
            `Object must contain at least ${schema.minProperties} properties.`
          )
        );
      }

      if (
        schema.maxProperties !== undefined &&
        keys.length > schema.maxProperties
      ) {
        errors.push(
          createError(
            path,
            "TOO_MANY_PROPERTIES",
            `Object must contain no more than ${schema.maxProperties} properties.`
          )
        );
      }

      for (const requiredKey of schema.required ?? []) {
        if (
          !Object.prototype.hasOwnProperty.call(
            value,
            requiredKey
          )
        ) {
          errors.push(
            createError(
              `${path}.${requiredKey}`,
              "REQUIRED_FIELD_MISSING",
              `Required field "${requiredKey}" is missing.`
            )
          );
        }
      }

      for (const key of keys) {
        const propertyPath = `${path}.${key}`;

        if (isReservedKey(key)) {
          errors.push(
            createError(
              propertyPath,
              "RESERVED_PROPERTY",
              `Reserved property name "${key}" is not allowed.`
            )
          );
          continue;
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
          errors.push(
            createError(
              propertyPath,
              "ACCESSOR_NOT_ALLOWED",
              "Accessor properties are not allowed in validation data."
            )
          );
          continue;
        }

        const propertySchema = schema.properties?.[key];

        if (propertySchema) {
          validateValue(
            descriptor.value,
            propertySchema,
            propertyPath,
            errors,
            stack,
            depth + 1,
            maxDepth
          );
        } else if (schema.additionalProperties === false) {
          errors.push(
            createError(
              propertyPath,
              "UNKNOWN_PROPERTY",
              `Property "${key}" is not allowed.`
            )
          );
        }
      }
    } finally {
      stack.delete(value);
    }
  }
}

/**
 * Central schema and engine validator.
 */
export class EngineValidator {
  #schemas;
  #maxDepth;

  constructor({ maxDepth = 32 } = {}) {
    if (
      !Number.isSafeInteger(maxDepth) ||
      maxDepth < 1 ||
      maxDepth > 128
    ) {
      throw new RangeError(
        "maxDepth must be an integer between 1 and 128."
      );
    }

    this.#schemas = new Map();
    this.#maxDepth = maxDepth;
  }

  /**
   * Register a reusable validation schema.
   */
  registerSchema(schemaId, schema, { replace = false } = {}) {
    if (
      typeof schemaId !== "string" ||
      schemaId.trim().length === 0
    ) {
      throw new TypeError(
        "Schema ID must be a non-empty string."
      );
    }

    if (typeof replace !== "boolean") {
      throw new TypeError(
        "Schema replace option must be a boolean."
      );
    }

    const id = schemaId.trim();

    if (this.#schemas.has(id) && !replace) {
      throw new EngineError(
        `Schema "${id}" is already registered.`,
        {
          code: "SCHEMA_ALREADY_REGISTERED",
        }
      );
    }

    const normalized = normalizeSchema(
      schema,
      `$schema:${id}`,
      new WeakSet(),
      0,
      this.#maxDepth
    );

    this.#schemas.set(id, normalized);

    return {
      id,
      registered: true,
    };
  }

  /** Retrieve a registered schema. */
  getSchema(schemaId) {
    return this.#schemas.get(schemaId) ?? null;
  }

  /** Check whether a schema exists. */
  hasSchema(schemaId) {
    return this.#schemas.has(schemaId);
  }

  /** List registered schema identifiers. */
  listSchemas() {
    return [...this.#schemas.keys()];
  }

  /** Remove a registered schema. */
  unregisterSchema(schemaId) {
    return this.#schemas.delete(schemaId);
  }

  /**
   * Validate data against a schema object or registered schema ID.
   *
   * Returns:
   * {
   *   valid: boolean,
   *   errors: Array
   * }
   */
  validate(value, schemaOrId, { path = "$" } = {}) {
    if (
      typeof path !== "string" ||
      path.trim().length === 0
    ) {
      throw new TypeError(
        "Validation path must be a non-empty string."
      );
    }

    let schema;
    let schemaId = null;

    if (typeof schemaOrId === "string") {
      schemaId = schemaOrId.trim();
      schema = this.getSchema(schemaId);

      if (!schema) {
