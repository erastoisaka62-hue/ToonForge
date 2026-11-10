
import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_SCHEMA_VERSION,
  DEFAULT_PROJECT_SETTINGS,
  createProject,
  validateProject,
  serializeProject,
  deserializeProject,
  updateProject,
} from "../../src/project/project-model.js";

function expectProjectError(callback, expectedCode) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function makeProject() {
  return createProject({
    id: "project_test_001",
    name: "Test Cartoon",
    description: "Project model test",
    scenes: [
      { id: "scene_001", name: "Opening Scene" },
    ],
    assets: [
      { id: "asset_001", type: "character" },
    ],
    metadata: {
      author: "ToonForge",
    },
  });
}

// --------------------------------------------------
// DEFAULTS AND PROJECT CREATION
// --------------------------------------------------

test("exports project schema version 1", () => {
  assert.equal(PROJECT_SCHEMA_VERSION, 1);
});

test("exports immutable default settings", () => {
  assert.deepEqual(DEFAULT_PROJECT_SETTINGS, {
    width: 1280,
    height: 720,
    fps: 24,
    aspectRatio: "16:9",
  });

  assert.equal(Object.isFrozen(DEFAULT_PROJECT_SETTINGS), true);
});

test("creates a project with default values", () => {
  const project = createProject();

  assert.equal(typeof project.id, "string");
  assert.ok(project.id.length > 0);
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.name, "Untitled Project");
  assert.equal(project.description, "");
  assert.deepEqual(project.settings, DEFAULT_PROJECT_SETTINGS);
  assert.deepEqual(project.scenes, []);
  assert.deepEqual(project.assets, []);
  assert.deepEqual(project.metadata, {});
  assert.ok(Number.isFinite(Date.parse(project.createdAt)));
  assert.ok(Number.isFinite(Date.parse(project.updatedAt)));
});

test("creates a project with custom values", () => {
  const project = createProject({
    id: "custom_project",
    name: "My Animation",
    description: "A cartoon project",
  });

  assert.equal(project.id, "custom_project");
  assert.equal(project.name, "My Animation");
  assert.equal(project.description, "A cartoon project");
});

test("merges custom creation settings with defaults", () => {
  const project = createProject({
    settings: {
      width: 1920,
      height: 1080,
    },
  });

  assert.deepEqual(project.settings, {
    width: 1920,
    height: 1080,
    fps: 24,
    aspectRatio: "16:9",
  });
});

test("creates independent copies of input collections", () => {
  const scenes = [
    { id: "scene_001", name: "Village" },
  ];

  const metadata = {
    author: "Creator",
    details: {
      language: "English",
    },
  };

  const project = createProject({ scenes, metadata });

  scenes[0].name = "Changed";
  metadata.details.language = "Changed";

  assert.equal(project.scenes[0].name, "Village");
  assert.equal(project.metadata.details.language, "English");
});

test("rejects invalid creation options", () => {
  expectProjectError(
    () => createProject(null),
    "INVALID_OPTIONS"
  );

  expectProjectError(
    () => createProject([]),
    "INVALID_OPTIONS"
  );

  expectProjectError(
    () => createProject("invalid"),
    "INVALID_OPTIONS"
  );
});

test("rejects unknown creation options", () => {
  expectProjectError(
    () => createProject({ unknownOption: true }),
    "UNKNOWN_OPTION"
  );
});

test("rejects accessor properties without invoking getters", () => {
  let getterCalled = false;
  const options = {};

  Object.defineProperty(options, "name", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "Unsafe";
    },
  });

  expectProjectError(
    () => createProject(options),
    "ACCESSOR_NOT_ALLOWED"
  );

  assert.equal(getterCalled, false);
});

test("rejects nested accessors before settings are merged", () => {
  let getterCalled = false;
  const settings = {};

  Object.defineProperty(settings, "width", {
    enumerable: true,
    get() {
      getterCalled = true;
      return 1920;
    },
  });

  expectProjectError(
    () => createProject({ settings }),
    "ACCESSOR_NOT_ALLOWED"
  );

  assert.equal(getterCalled, false);
});

test("rejects null settings when explicitly supplied", () => {
  expectProjectError(
    () => createProject({ settings: null }),
    "INVALID_SETTINGS"
  );
});

test("rejects symbol properties in creation options", () => {
  const options = { name: "Unsafe" };
  options[Symbol("hidden")] = "value";

  expectProjectError(
    () => createProject(options),
    "INVALID_PROPERTY"
  );
});

// --------------------------------------------------
// SETTINGS AND COLLECTION VALIDATION
// --------------------------------------------------

test("rejects invalid project dimensions", () => {
  expectProjectError(
    () => createProject({
      settings: { width: 10 },
    }),
    "INVALID_SETTING"
  );

  expectProjectError(
    () => createProject({
      settings: { height: 20000 },
    }),
    "INVALID_SETTING"
  );
});

test("rejects invalid FPS values", () => {
  expectProjectError(
    () => createProject({
      settings: { fps: 0 },
    }),
    "INVALID_SETTING"
  );

  expectProjectError(
    () => createProject({
      settings: { fps: 121 },
    }),
    "INVALID_SETTING"
  );
});

test("rejects unknown project settings", () => {
  expectProjectError(
    () => createProject({
      settings: { unknownSetting: true },
    }),
    "UNKNOWN_SETTING"
  );
});

test("rejects empty project names", () => {
  expectProjectError(
    () => createProject({ name: "   " }),
    "INVALID_STRING"
  );
});

test("rejects duplicate scene IDs", () => {
  expectProjectError(
    () => createProject({
      scenes: [
        { id: "scene_001" },
        { id: "scene_001" },
      ],
    }),
    "DUPLICATE_ITEM_ID"
  );
});

test("rejects duplicate asset IDs", () => {
  expectProjectError(
    () => createProject({
      assets: [
        { id: "asset_001" },
        { id: "asset_001" },
      ],
    }),
    "DUPLICATE_ITEM_ID"
  );
});

test("rejects collection items without IDs", () => {
  expectProjectError(
    () => createProject({
      scenes: [{ name: "Missing ID" }],
    }),
    "INVALID_STRING"
  );
});

// --------------------------------------------------
// PROJECT VALIDATION
// --------------------------------------------------

test("accepts a valid project", () => {
  const result = validateProject(makeProject());

  assert.deepEqual(result, {
    valid: true,
    errors: [],
  });
});

test("rejects null as a project", () => {
  const result = validateProject(null);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "INVALID_PROJECT");
});

test("rejects missing required properties", () => {
  const project = makeProject();
  delete project.name;

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "MISSING_PROPERTY");
});

test("rejects unknown project properties", () => {
  const project = makeProject();
  project.unknownProperty = true;

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "UNKNOWN_PROPERTY");
});

test("rejects unsupported schema versions", () => {
  const project = makeProject();
  project.schemaVersion = 999;

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(
    result.errors[0].code,
    "UNSUPPORTED_SCHEMA_VERSION"
  );
});

test("rejects invalid timestamps", () => {
  const project = makeProject();
  project.createdAt = "not-a-date";

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(
    result.errors[0].code,
    "INVALID_TIMESTAMP"
  );
});

test("rejects non-finite numbers", () => {
  const project = makeProject();
  project.metadata.value = Infinity;

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "INVALID_NUMBER");
});

test("rejects circular data", () => {
  const project = makeProject();
  project.metadata.self = project.metadata;

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "CIRCULAR_DATA");
});

test("rejects reserved property names", () => {
  const project = makeProject();

  Object.defineProperty(project.metadata, "__proto__", {
    value: "unsafe",
    enumerable: true,
    configurable: true,
  });

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "INVALID_PROPERTY");
});

test("rejects accessor properties in project data", () => {
  const project = makeProject();

  Object.defineProperty(project.metadata, "unsafe", {
    enumerable: true,
    get() {
      return "unsafe";
    },
  });

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(
    result.errors[0].code,
    "ACCESSOR_NOT_ALLOWED"
  );
});

test("rejects sparse arrays", () => {
  const project = makeProject();
  project.metadata.items = new Array(3);

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, "SPARSE_ARRAY");
});

test("rejects unsupported data types", () => {
  const project = makeProject();
  project.metadata.callback = () => {};

  const result = validateProject(project);

  assert.equal(result.valid, false);
  assert.equal(
    result.errors[0].code,
    "UNSUPPORTED_DATA_TYPE"
  );
});

// --------------------------------------------------
// SERIALIZATION AND DESERIALIZATION
// --------------------------------------------------

test("serializes a valid project into JSON", () => {
  const project = makeProject();
  const json = serializeProject(project);

  assert.equal(typeof json, "string");
  assert.deepEqual(JSON.parse(json), project);
});

test("rejects serialization of an invalid project", () => {
  const project = makeProject();
  project.name = "";

  expectProjectError(
    () => serializeProject(project),
    "INVALID_STRING"
  );
});

test("restores a project from valid JSON", () => {
  const original = makeProject();
  const json = serializeProject(original);

  const restored = deserializeProject(json);

  assert.deepEqual(restored, original);
  assert.notEqual(restored, original);
});

test("deserialization returns an independent copy", () => {
  const original = makeProject();

  const restored = deserializeProject(
    serializeProject(original)
  );

  restored.scenes[0].name = "Changed";

  assert.equal(original.scenes[0].name, "Opening Scene");
});

test("rejects non-string JSON input", () => {
  expectProjectError(
    () => deserializeProject({}),
    "INVALID_JSON_INPUT"
  );
});

test("rejects malformed JSON", () => {
  expectProjectError(
    () => deserializeProject("{invalid"),
    "INVALID_JSON"
  );
});

test("rejects JSON that is not a valid project", () => {
  expectProjectError(
    () => deserializeProject(
      JSON.stringify({ name: "Not a project" })
    ),
    "MISSING_PROPERTY"
  );
});

// --------------------------------------------------
// PROJECT UPDATES
// --------------------------------------------------

test("updates project name without changing identity", () => {
  const original = makeProject();

  const updated = updateProject(original, {
    name: "Updated Cartoon",
  });

  assert.equal(updated.name, "Updated Cartoon");
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.ok(Number.isFinite(Date.parse(updated.updatedAt)));
});

test("updates settings using a complete settings object", () => {
  const original = makeProject();

  const updated = updateProject(original, {
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      aspectRatio: "16:9",
    },
  });

  assert.deepEqual(updated.settings, {
    width: 1920,
    height: 1080,
    fps: 30,
    aspectRatio: "16:9",
  });
});

test("does not mutate the original project", () => {
  const original = makeProject();

  const updated = updateProject(original, {
    name: "New Name",
  });

  assert.equal(original.name, "Test Cartoon");
  assert.equal(updated.name, "New Name");
  assert.notEqual(updated, original);
});

test("rejects changes to immutable properties", () => {
  const project = makeProject();

  expectProjectError(
    () => updateProject(project, { id: "changed" }),
    "IMMUTABLE_OR_UNKNOWN_PROPERTY"
  );

  expectProjectError(
    () => updateProject(project, { schemaVersion: 2 }),
    "IMMUTABLE_OR_UNKNOWN_PROPERTY"
  );

  expectProjectError(
    () => updateProject(project, {
      createdAt: "2020-01-01T00:00:00.000Z",
    }),
    "IMMUTABLE_OR_UNKNOWN_PROPERTY"
  );
});

test("rejects accessor properties in update changes", () => {
  const project = makeProject();
  let getterCalled = false;
  const changes = {};

  Object.defineProperty(changes, "name", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "Unsafe";
    },
  });

  expectProjectError(
    () => updateProject(project, changes),
    "ACCESSOR_NOT_ALLOWED"
  );

  assert.equal(getterCalled, false);
});

test("rejects unsupported nested update values", () => {
  const project = makeProject();

  expectProjectError(
    () => updateProject(project, {
      metadata: {
        callback: () => {},
      },
    }),
    "UNSUPPORTED_DATA_TYPE"
  );
});

test("rejects updates to an invalid source project", () => {
  const project = makeProject();
  project.name = "";

  expectProjectError(
    () => updateProject(project, {
      description: "Updated",
    }),
    "INVALID_SOURCE_PROJECT"
  );
});

test("rejects invalid update argument types", () => {
  const project = makeProject();

  expectProjectError(
    () => updateProject(project, null),
    "INVALID_CHANGES"
  );

  expectProjectError(
    () => updateProject(project, []),
    "INVALID_CHANGES"
  );
});

test("rejects unknown update properties", () => {
  const project = makeProject();

  expectProjectError(
    () => updateProject(project, {
      unknownProperty: true,
    }),
    "IMMUTABLE_OR_UNKNOWN_PROPERTY"
  );
});
