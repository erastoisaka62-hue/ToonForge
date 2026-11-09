/**
 * ToonForge — Engine Validator Tests
 *
 * Covers schema normalization, primitive validation,
 * nested objects, arrays, constraints, schema registry,
 * circular data and unsafe object properties.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EngineValidator,
} from "../../src/core/engine-validator.js";

import {
  EngineError,
} from "../../src/core/engine-base.js";

function findError(result, code) {
  return result.errors.find((error) => error.code === code);
}

describe("EngineValidator", () => {
  describe("constructor", () => {
    it("should create a validator with default configuration", () => {
      const validator = new EngineValidator();

      assert.ok(validator instanceof EngineValidator);
      assert.deepEqual(validator.listSchemas(), []);
    });

    it("should accept a valid custom maximum depth", () => {
      assert.doesNotThrow(
        () => new EngineValidator({ maxDepth: 10 })
      );
    });

    it("should reject invalid maximum depth values", () => {
      for (const maxDepth of [0, -1, 1.5, 129, NaN, Infinity]) {
        assert.throws(
          () => new EngineValidator({ maxDepth }),
          RangeError
        );
      }
    });
  });

  describe("primitive validation", () => {
    const validator = new EngineValidator();

    it("should validate strings", () => {
      const result = validator.validate(
        "ToonForge",
        { type: "string" }
      );

      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    it("should reject values with an incorrect type", () => {
      const result = validator.validate(
        123,
        { type: "string" }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "TYPE_MISMATCH"));
    });

    it("should validate finite numbers", () => {
      assert.equal(
        validator.validate(12.5, { type: "number" }).valid,
        true
      );

      assert.equal(
        validator.validate(Infinity, { type: "number" }).valid,
        false
      );

      assert.equal(
        validator.validate(NaN, { type: "number" }).valid,
        false
      );
    });

    it("should distinguish integers from decimal numbers", () => {
      assert.equal(
        validator.validate(10, { type: "integer" }).valid,
        true
      );

      assert.equal(
        validator.validate(10.5, { type: "integer" }).valid,
        false
      );

      assert.equal(
        validator.validate(Number.MAX_SAFE_INTEGER + 1, {
          type: "integer",
        }).valid,
        false
      );
    });

    it("should validate boolean values", () => {
      assert.equal(
        validator.validate(true, { type: "boolean" }).valid,
        true
      );

      assert.equal(
        validator.validate("true", { type: "boolean" }).valid,
        false
      );
    });

    it("should reject null unless the schema allows it", () => {
      const strictResult = validator.validate(
        null,
        { type: "string" }
      );

      const nullableResult = validator.validate(
        null,
        {
          type: "string",
          nullable: true,
        }
      );

      assert.equal(strictResult.valid, false);
      assert.ok(findError(strictResult, "NULL_NOT_ALLOWED"));
      assert.equal(nullableResult.valid, true);
    });

    it("should allow null when null is explicitly included in enum", () => {
      const result = validator.validate(
        null,
        {
          type: "string",
          enum: ["ready", null],
        }
      );

      assert.equal(result.valid, true);
    });

    it("should validate enum values", () => {
      const schema = {
        type: "string",
        enum: ["low", "medium", "high"],
      };

      assert.equal(
        validator.validate("high", schema).valid,
        true
      );

      const invalid = validator.validate("ultra", schema);

      assert.equal(invalid.valid, false);
      assert.ok(findError(invalid, "ENUM_MISMATCH"));
    });
  });

  describe("string constraints", () => {
    const validator = new EngineValidator();

    it("should enforce minimum and maximum string lengths", () => {
      const schema = {
        type: "string",
        minLength: 3,
        maxLength: 8,
      };

      assert.equal(
        validator.validate("Toon", schema).valid,
        true
      );

      const tooShort = validator.validate("AI", schema);
      const tooLong = validator.validate("Animation", schema);

      assert.ok(findError(tooShort, "STRING_TOO_SHORT"));
      assert.ok(findError(tooLong, "STRING_TOO_LONG"));
    });

    it("should count Unicode characters correctly", () => {
      const result = validator.validate(
        "🎬🎨",
        {
          type: "string",
          minLength: 2,
          maxLength: 2,
        }
      );

      assert.equal(result.valid, true);
    });

    it("should validate regular expression patterns", () => {
      const schema = {
        type: "string",
        pattern: "^[a-z0-9-]+$",
      };

      assert.equal(
        validator.validate("hero-character-01", schema).valid,
        true
      );

      const invalid = validator.validate(
        "Hero Character!",
        schema
      );

      assert.equal(invalid.valid, false);
      assert.ok(findError(invalid, "PATTERN_MISMATCH"));
    });
  });

  describe("numeric constraints", () => {
    const validator = new EngineValidator();

    it("should enforce minimum and maximum values", () => {
      const schema = {
        type: "number",
        min: 0,
        max: 100,
      };

      assert.equal(
        validator.validate(50, schema).valid,
        true
      );

      const tooSmall = validator.validate(-1, schema);
      const tooLarge = validator.validate(101, schema);

      assert.ok(findError(tooSmall, "NUMBER_TOO_SMALL"));
      assert.ok(findError(tooLarge, "NUMBER_TOO_LARGE"));
    });

    it("should support numeric boundaries", () => {
      const schema = {
        type: "integer",
        min: 1,
        max: 10,
      };

      assert.equal(
        validator.validate(1, schema).valid,
        true
      );

      assert.equal(
        validator.validate(10, schema).valid,
        true
      );
    });
  });

  describe("object validation", () => {
    const validator = new EngineValidator();

    const characterSchema = {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          minLength: 1,
        },
        name: {
          type: "string",
          minLength: 2,
        },
        age: {
          type: "integer",
          min: 0,
        },
      },
      additionalProperties: false,
    };

    it("should validate a complete nested object", () => {
      const character = {
        id: "hero-001",
        name: "Hero",
        age: 25,
      };

      const result = validator.validate(
        character,
        characterSchema
      );

      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    it("should report missing required properties", () => {
      const result = validator.validate(
        {
          id: "hero-001",
        },
        characterSchema
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "REQUIRED_FIELD_MISSING"));
    });

    it("should reject unknown properties when additionalProperties is false", () => {
      const result = validator.validate(
        {
          id: "hero-001",
          name: "Hero",
          secret: true,
        },
        characterSchema
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "UNKNOWN_PROPERTY"));
    });

    it("should allow unknown properties by default", () => {
      const result = validator.validate(
        {
          id: "hero-001",
          name: "Hero",
          customField: "extra data",
        },
        {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
          },
        }
      );

      assert.equal(result.valid, true);
    });

    it("should validate nested object properties", () => {
      const schema = {
        type: "object",
        required: ["transform"],
        properties: {
          transform: {
            type: "object",
            required: ["x", "y", "z"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            additionalProperties: false,
          },
        },
      };

      const result = validator.validate(
        {
          transform: {
            x: 0,
            y: 2,
            z: 5,
          },
        },
        schema
      );

      assert.equal(result.valid, true);
    });

    it("should enforce minimum and maximum object properties", () => {
      const schema = {
        type: "object",
        minProperties: 2,
        maxProperties: 3,
      };

      const tooSmall = validator.validate(
        { id: "one" },
        schema
      );

      const tooLarge = validator.validate(
        {
          id: "one",
          name: "two",
          type: "three",
          extra: "four",
        },
        schema
      );

      assert.ok(findError(tooSmall, "TOO_FEW_PROPERTIES"));
      assert.ok(findError(tooLarge, "TOO_MANY_PROPERTIES"));
    });
  });

  describe("array validation", () => {
    const validator = new EngineValidator();

    it("should validate arrays and their item types", () => {
      const result = validator.validate(
        [1, 2, 3],
        {
          type: "array",
          items: {
            type: "integer",
          },
        }
      );

      assert.equal(result.valid, true);
    });

    it("should reject invalid array item types", () => {
      const result = validator.validate(
        [1, "two", 3],
        {
          type: "array",
          items: {
            type: "number",
          },
        }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "TYPE_MISMATCH"));
    });

    it("should enforce minimum and maximum array lengths", () => {
      const schema = {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "string",
        },
      };

      const tooShort = validator.validate(["one"], schema);
      const tooLong = validator.validate(
        ["one", "two", "three", "four", "five"],
        schema
      );

      assert.ok(findError(tooShort, "ARRAY_TOO_SHORT"));
      assert.ok(findError(tooLong, "ARRAY_TOO_LONG"));
    });

    it("should reject sparse arrays when item validation is enabled", () => {
      const sparse = new Array(2);
      sparse[1] = "second";

      const result = validator.validate(
        sparse,
        {
          type: "array",
          items: {
            type: "string",
          },
        }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "ARRAY_HOLE"));
    });

    it("should reject accessor array entries without invoking getters", () => {
      let getterCalled = false;
      const values = [];

      Object.defineProperty(values, "0", {
        enumerable: true,
        configurable: true,
        get() {
          getterCalled = true;
          return "unsafe";
        },
      });

      values.length = 1;

      const result = validator.validate(
        values,
        {
          type: "array",
          items: {
            type: "string",
          },
        }
      );

      assert.equal(result.valid, false);
      assert.equal(getterCalled, false);
      assert.ok(findError(result, "ACCESSOR_NOT_ALLOWED"));
    });
  });

  describe("unsafe and circular data", () => {
    const validator = new EngineValidator();

    it("should reject circular object references", () => {
      const character = {
        id: "hero-001",
      };

      character.self = character;

      const result = validator.validate(
        character,
        {
          type: "object",
          properties: {
            id: { type: "string" },
            self: { type: "object" },
          },
        }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "CIRCULAR_DATA"));
    });

    it("should reject circular array references", () => {
      const values = [];
      values.push(values);

      const result = validator.validate(
        values,
        {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "number",
            },
          },
        }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "CIRCULAR_DATA"));
    });

    it("should reject reserved object property names", () => {
      const value = {};

      Object.defineProperty(value, "constructor", {
        value: "unsafe",
        enumerable: true,
        configurable: true,
      });

      const result = validator.validate(
        value,
        {
          type: "object",
        }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "RESERVED_PROPERTY"));
    });

    it("should reject accessor object properties without invoking getters", () => {
      let getterCalled = false;
      const value = {};

      Object.defineProperty(value, "name", {
        enumerable: true,
        configurable: true,
        get() {
          getterCalled = true;
          return "Hero";
        },
      });

      const result = validator.validate(
        value,
        {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
          },
        }
      );

      assert.equal(result.valid, false);
      assert.equal(getterCalled, false);
      assert.ok(findError(result, "ACCESSOR_NOT_ALLOWED"));
    });

    it("should report values exceeding the configured nesting depth", () => {
      const limitedValidator = new EngineValidator({
        maxDepth: 1,
      });

      const result = limitedValidator.validate(
        {
          child: {
            name: "Too Deep",
          },
        },
        {
          type: "object",
          properties: {
            child: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                },
              },
            },
          },
        }
      );

      assert.equal(result.valid, false);
      assert.ok(findError(result, "MAX_DEPTH_EXCEEDED"));
    });
  });

  describe("schema normalization", () => {
    const validator = new EngineValidator();

    it("should reject unsupported schema types", () => {
      assert.throws(
        () => validator.validate(
          "value",
          { type: "date" }
        ),
        TypeError
      );
    });

    it("should reject unknown schema options", () => {
      assert.throws(
        () => validator.validate(
          "value",
          {
            type: "string",
            unsupportedOption: true,
          }
        ),
        TypeError
      );
    });

    it("should reject invalid schema constraints", () => {
      assert.throws(
        () => validator.validate(
          "value",
          {
            type: "string",
            minLength: -1,
          }
        ),
        TypeError
      );

      assert.throws(
        () => validator.validate(
          5,
          {
            type: "number",
            min: 10,
            max: 2,
          }
        ),
        TypeError
      );
    });

    it("should reject duplicate required property names", () => {
      assert.throws(
        () => validator.validate(
          {},
          {
            type: "object",
            required: ["id", "id"],
          }
        ),
        TypeError
      );
    });

    it("should reject circular schema definitions", () => {
      const schema = {
        type: "object",
        properties: {},
      };

      schema.properties.self = schema;

      assert.throws(
        () => validator.validate({}, schema),
        TypeError
      );
    });

    it("should reject invalid validation paths", () => {
      assert.throws(
        () => validator.validate(
          "Hero",
          { type: "string" },
          { path: "" }
        ),
        TypeError
      );
    });
  });

  describe("schema registry", () => {
    it("should register and retrieve reusable schemas", () => {
      const validator = new EngineValidator();

      const registration = validator.registerSchema(
        "character",
        {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string",
            },
          },
        }
      );

      assert.deepEqual(registration, {
        id: "character",
        registered: true,
      });

      assert.equal(validator.hasSchema("character"), true);
      assert.ok(validator.getSchema("character"));
      assert.deepEqual(validator.listSchemas(), ["character"]);
    });

    it("should validate data using a registered schema ID", () => {
      const validator = new EngineValidator();

      validator.registerSchema(
        "scene",
        {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
          },
          additionalProperties: false,
        }
      );

      const result = validator.validate(
        {
          id: "scene-001",
          name: "Opening Scene",
        },
        "scene"
      );

      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    it("should prevent duplicate schema registration by default", () => {
      const validator = new EngineValidator();

      validator.registerSchema(
        "project",
        { type: "object" }
      );

      assert.throws(
        () => validator.registerSchema(
          "project",
          { type: "string" }
        ),
        (error) => {
          assert.ok(error instanceof EngineError);
          assert.equal(
            error.code,
            "SCHEMA_ALREADY_REGISTERED"
          );

          return true;
        }
      );
    });

    it("should replace a registered schema when explicitly allowed", () => {
      const validator = new EngineValidator();

      validator.registerSchema(
        "asset",
        { type: "string" }
      );

      validator.registerSchema(
        "asset",
        { type: "integer" },
        { replace: true }
      );

      assert.equal(
        validator.validate(10, "asset").valid,
        true
      );

      assert.equal(
        validator.validate("ten", "asset").valid,
        false
      );
    });

    it("should reject invalid schema registration arguments", () => {
      const validator = new EngineValidator();

      assert.throws(
        () => validator.registerSchema(
          "",
          { type: "string" }
        ),
        TypeError
      );

      assert.throws(
        () => validator.registerSchema(
          "valid-id",
          { type: "string" },
          { replace: "yes" }
        ),
        TypeError
      );
    });

    it("should unregister schemas safely", () => {
      const validator = new EngineValidator();

      validator.registerSchema(
        "temporary",
        { type: "string" }
      );

      assert.equal(
        validator.unregisterSchema("temporary"),
        true
      );

      assert.equal(
        validator.unregisterSchema("temporary"),
        false
      );

      assert.equal(validator.hasSchema("temporary"), false);
      assert.equal(validator.getSchema("temporary"), null);
    });

    it("should return a defensive schema list", () => {
      const validator = new EngineValidator();

      validator.registerSchema(
        "character",
        { type:
