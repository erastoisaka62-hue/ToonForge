
import test from "node:test";
import assert from "node:assert/strict";

import {
  createEngineConfig,
  DEFAULT_ENGINE_CONFIG,
  engineConfig,
  getEngineConfig,
  validateEngineConfig,
} from "../../src/core/engine-config.js";

test("default configuration exposes all required sections", () => {
  assert.deepEqual(
    Object.keys(DEFAULT_ENGINE_CONFIG),
    [
      "runtime",
      "validation",
      "rendering",
      "storage",
      "logging",
    ]
  );
});

test("default configuration contains expected runtime values", () => {
  assert.equal(
    DEFAULT_ENGINE_CONFIG.runtime.maxPipelineSteps,
    2000
  );

  assert.equal(
    DEFAULT_ENGINE_CONFIG.runtime.maxConcurrentTasks,
    1
  );

  assert.equal(
    DEFAULT_ENGINE_CONFIG.runtime.executionTimeoutMs,
    0
  );
});

test("default configuration contains expected rendering values", () => {
  assert.equal(
    DEFAULT_ENGINE_CONFIG.rendering.defaultWidth,
    1280
  );

  assert.equal(
    DEFAULT_ENGINE_CONFIG.rendering.defaultHeight,
    720
  );

  assert.equal(
    DEFAULT_ENGINE_CONFIG.rendering.defaultFps,
    24
  );

  assert.equal(
    DEFAULT_ENGINE_CONFIG.rendering.quality,
    "preview"
  );

  assert.equal(
    DEFAULT_ENGINE_CONFIG.rendering.format,
    "webgl"
  );
});

test("default configuration is deeply immutable", () => {
  assert.equal(
    Object.isFrozen(DEFAULT_ENGINE_CONFIG),
    true
  );

  for (const section of Object.values(DEFAULT_ENGINE_CONFIG)) {
    assert.equal(Object.isFrozen(section), true);
  }
});

test("shared configuration uses the default immutable instance", () => {
  assert.equal(engineConfig, DEFAULT_ENGINE_CONFIG);
  assert.equal(getEngineConfig(), DEFAULT_ENGINE_CONFIG);
});

test("getEngineConfig returns the same shared configuration", () => {
  const first = getEngineConfig();
  const second = getEngineConfig();

  assert.equal(first, second);
});

test("createEngineConfig returns an independent configuration", () => {
  const first = createEngineConfig();
  const second = createEngineConfig();

  assert.notEqual(first, second);
  assert.notEqual(first.runtime, second.runtime);
  assert.deepEqual(first, second);
});

test("createEngineConfig applies valid nested overrides", () => {
  const config = createEngineConfig({
    runtime: {
      maxPipelineSteps: 500,
      maxConcurrentTasks: 4,
    },
    rendering: {
      defaultWidth: 1920,
      defaultHeight: 1080,
      quality: "high",
    },
  });

  assert.equal(config.runtime.maxPipelineSteps, 500);
  assert.equal(config.runtime.maxConcurrentTasks, 4);
  assert.equal(config.rendering.defaultWidth, 1920);
  assert.equal(config.rendering.defaultHeight, 1080);
  assert.equal(config.rendering.quality, "high");

  assert.equal(
    config.runtime.executionTimeoutMs,
    DEFAULT_ENGINE_CONFIG.runtime.executionTimeoutMs
  );
});

test("configuration overrides do not mutate the defaults", () => {
  const originalWidth =
    DEFAULT_ENGINE_CONFIG.rendering.defaultWidth;

  createEngineConfig({
    rendering: {
      defaultWidth: 2560,
    },
  });

  assert.equal(
    DEFAULT_ENGINE_CONFIG.rendering.defaultWidth,
    originalWidth
  );
});

test("configuration overrides do not mutate the input object", () => {
  const overrides = {
    runtime: {
      maxPipelineSteps: 750,
    },
  };

  const originalValue =
    overrides.runtime.maxPipelineSteps;

  createEngineConfig(overrides);

  assert.equal(
    overrides.runtime.maxPipelineSteps,
    originalValue
  );
});

test("created configuration is deeply immutable", () => {
  const config = createEngineConfig({
    rendering: {
      defaultWidth: 1920,
    },
  });

  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.rendering), true);
  assert.equal(Object.isFrozen(config.runtime), true);
});

test("createEngineConfig accepts an empty configuration", () => {
  const config = createEngineConfig({});

  assert.deepEqual(config, DEFAULT_ENGINE_CONFIG);
});

test("createEngineConfig accepts null-prototype configuration objects", () => {
  const overrides = Object.create(null);
  const runtime = Object.create(null);

  runtime.maxPipelineSteps = 900;
  overrides.runtime = runtime;

  const config = createEngineConfig(overrides);

  assert.equal(
    config.runtime.maxPipelineSteps,
    900
  );
});

test("createEngineConfig rejects null configuration", () => {
  assert.throws(
    () => createEngineConfig(null),
    {
      name: "TypeError",
      code: "INVALID_CONFIG",
      path: "config",
    }
  );
});

test("createEngineConfig rejects array configuration", () => {
  assert.throws(
    () => createEngineConfig([]),
    {
      name: "TypeError",
      code: "INVALID_CONFIG",
    }
  );
});

test("createEngineConfig rejects primitive configuration", () => {
  assert.throws(
    () => createEngineConfig("invalid"),
    {
      name: "TypeError",
      code: "INVALID_CONFIG",
    }
  );
});

test("createEngineConfig rejects unknown top-level properties", () => {
  assert.throws(
    () => createEngineConfig({
      unknownSection: {},
    }),
    {
      name: "TypeError",
      code: "UNKNOWN_KEY",
      path: "config.unknownSection",
    }
  );
});

test("createEngineConfig rejects unknown nested properties", () => {
  assert.throws(
    () => createEngineConfig({
      runtime: {
        unknownOption: true,
      },
    }),
    {
      name: "TypeError",
      code: "UNKNOWN_KEY",
      path: "config.runtime.unknownOption",
    }
  );
});

test("createEngineConfig rejects symbol configuration keys", () => {
  const overrides = {
    runtime: {
      maxPipelineSteps: 500,
    },
  };

  overrides[Symbol("unexpected")] = true;

  assert.throws(
    () => createEngineConfig(overrides),
    {
      name: "TypeError",
      code: "UNKNOWN_KEY",
    }
  );
});

test("createEngineConfig rejects accessor properties", () => {
  const overrides = {};

  Object.defineProperty(overrides, "runtime", {
    enumerable: true,
    get() {
      return {
        maxPipelineSteps: 500,
      };
    },
  });

  assert.throws(
    () => createEngineConfig(overrides),
    {
      name: "TypeError",
      code: "ACCESSOR_NOT_ALLOWED",
      path: "config.runtime",
    }
  );
});

test("createEngineConfig rejects nested accessor properties", () => {
  const runtime = {};

  Object.defineProperty(runtime, "maxPipelineSteps", {
    enumerable: true,
    get() {
      return 500;
    },
  });

  assert.throws(
    () => createEngineConfig({
      runtime,
    }),
    {
      name: "TypeError",
      code: "ACCESSOR_NOT_ALLOWED",
      path: "config.runtime.maxPipelineSteps",
    }
  );
});

test("createEngineConfig rejects non-object nested configuration", () => {
  assert.throws(
    () => createEngineConfig({
      runtime: null,
    }),
    {
      name: "TypeError",
      code: "INVALID_NESTED_CONFIG",
      path: "config.runtime",
    }
  );
});

test("createEngineConfig rejects arrays as nested configuration", () => {
  assert.throws(
    () => createEngineConfig({
      runtime: [],
    }),
    {
      name: "TypeError",
      code: "INVALID_NESTED_CONFIG",
    }
  );
});

test("createEngineConfig rejects object values for primitive options", () => {
  assert.throws(
    () => createEngineConfig({
      rendering: {
        quality: {
          value: "high",
        },
      },
    }),
    {
      name: "TypeError",
      code: "INVALID_VALUE",
      path: "config.rendering.quality",
    }
  );
});

test("runtime integer options enforce their valid ranges", () => {
  const invalidValues = [
    0,
    -1,
    10001,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  for (const value of invalidValues) {
    assert.throws(
      () => createEngineConfig({
        runtime: {
          maxPipelineSteps: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "runtime.maxPipelineSteps",
      }
    );
  }
});

test("runtime concurrency must be between 1 and 64", () => {
  for (const value of [0, 65, 1.5, "2"]) {
    assert.throws(
      () => createEngineConfig({
        runtime: {
          maxConcurrentTasks: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "runtime.maxConcurrentTasks",
      }
    );
  }
});

test("execution timeout accepts zero and safe non-negative integers", () => {
  const zero = createEngineConfig({
    runtime: {
      executionTimeoutMs: 0,
    },
  });

  const maximum = createEngineConfig({
    runtime: {
      executionTimeoutMs: Number.MAX_SAFE_INTEGER,
    },
  });

  assert.equal(zero.runtime.executionTimeoutMs, 0);

  assert.equal(
    maximum.runtime.executionTimeoutMs,
    Number.MAX_SAFE_INTEGER
  );
});

test("validation depth enforces its valid range", () => {
  for (const value of [0, 129, 1.5, "32"]) {
    assert.throws(
      () => createEngineConfig({
        validation: {
          maxDepth: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "validation.maxDepth",
      }
    );
  }
});

test("validation rejectUnknownProperties requires a boolean", () => {
  assert.throws(
    () => createEngineConfig({
      validation: {
        rejectUnknownProperties: "true",
      },
    }),
    {
      name: "TypeError",
      code: "INVALID_VALUE",
      path: "validation.rejectUnknownProperties",
    }
  );
});

test("rendering dimensions enforce valid integer ranges", () => {
  const invalidDimensions = [
    ["defaultWidth", 15],
    ["defaultWidth", 16385],
    ["defaultHeight", 15],
    ["defaultHeight", 16385],
  ];

  for (const [key, value] of invalidDimensions) {
    assert.throws(
      () => createEngineConfig({
        rendering: {
          [key]: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: `rendering.${key}`,
      }
    );
  }
});

test("rendering frame rate must be between 1 and 120", () => {
  for (const value of [0, 121, 24.5, "24"]) {
    assert.throws(
      () => createEngineConfig({
        rendering: {
          defaultFps: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "rendering.defaultFps",
      }
    );
  }
});

test("rendering quality accepts only supported values", () => {
  for (const quality of [
    "low",
    "maximum",
    "cinematic",
    "",
    5,
  ]) {
    assert.throws(
      () => createEngineConfig({
        rendering: {
          quality,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "rendering.quality",
      }
    );
  }
});

test("rendering format accepts only supported values", () => {
  for (const format of [
    "mp4",
    "webgl2",
    "unknown",
    "",
    10,
  ]) {
    assert.throws(
      () => createEngineConfig({
        rendering: {
          format,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "rendering.format",
      }
    );
  }
});

test("storage directories require non-empty trimmed strings", () => {
  for (const value of ["", " ", " projects", "assets ", null, 10]) {
    assert.throws(
      () => createEngineConfig({
        storage: {
          projectDirectory: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "storage.projectDirectory",
      }
    );
  }
});

test("storage autosave requires a boolean", () => {
  assert.throws(
    () => createEngineConfig({
      storage: {
        autosave: "yes",
      },
    }),
    {
      name: "TypeError",
      code: "INVALID_VALUE",
      path: "storage.autosave",
    }
  );
});

test("autosave interval must be at least 1000 milliseconds", () => {
  for (const value of [0, 999, 1.5, "60000"]) {
    assert.throws(
      () => createEngineConfig({
        storage: {
          autosaveIntervalMs: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "storage.autosaveIntervalMs",
      }
    );
  }
});

test("logging enabled requires a boolean", () => {
  assert.throws(
    () => createEngineConfig({
      logging: {
        enabled: 1,
      },
    }),
    {
      name: "TypeError",
      code: "INVALID_VALUE",
      path: "logging.enabled",
    }
  );
});

test("logging event capacity enforces its valid range", () => {
  for (const value of [0, 100001, 1.5, "1000"]) {
    assert.throws(
      () => createEngineConfig({
        logging: {
          maxEventEntries: value,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "logging.maxEventEntries",
      }
    );
  }
});

test("logging level accepts only supported values", () => {
  for (const level of [
    "trace",
    "fatal",
    "verbose",
    "",
    1,
  ]) {
    assert.throws(
      () => createEngineConfig({
        logging: {
          level,
        },
      }),
      {
        name: "TypeError",
        code: "INVALID_VALUE",
        path: "logging.level",
      }
    );
  }
});

test("validateEngineConfig returns a successful structured result", () => {
  const result = validateEngineConfig({
    runtime: {
      maxPipelineSteps: 600,
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);

  assert.equal(
    result.config.runtime.maxPipelineSteps,
    600
  );

  assert.equal(
    Object.isFrozen(result.config),
    true
  );
});

test("validateEngineConfig returns an error for invalid configuration", () => {
  const result = validateEngineConfig({
    runtime: {
      maxPipelineSteps: -10,
    },
  });

  assert.equal(result.valid, false);
  assert.equal(Array.isArray(result.errors), true);
  assert.equal(result.errors.length, 1);

  assert.equal(
    result.errors[0].code,
    "INVALID_VALUE"
  );

  assert.equal(
    result.errors[0].path,
    "runtime.maxPipelineSteps"
  );

  assert.equal(
    typeof result.errors[0].message,
    "string"
  );

  assert.equal("config" in result, false);
});

test("validateEngineConfig handles null input without throwing", () => {
  assert.doesNotThrow(() => {
    const result = validateEngineConfig(null);

    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 1);
    assert.equal(
      result.errors[0].code,
      "INVALID_CONFIG"
    );
  });
});

test("validateEngineConfig handles unknown configuration properties", () => {
  const result = validateEngineConfig({
    runtime: {
      unknownOption: true,
    },
  });

  assert.equal(result.valid, false);
  assert.equal(
    result.errors[0].code,
    "UNKNOWN_KEY"
  );
});

test("validateEngineConfig handles accessor properties without invoking getters", () => {
  let getterCalled = false;
  const overrides = {};

  Object.defineProperty(overrides, "runtime", {
    enumerable: true,
    get() {
      getterCalled = true;

      return {};
    },
  });

  const result = validateEngineConfig(overrides);

  assert.equal(result.valid, false);
  assert.equal(getterCalled, false);

  assert.equal(
    result.errors[0].code,
    "ACCESSOR_NOT_ALLOWED"
  );
});
                  
