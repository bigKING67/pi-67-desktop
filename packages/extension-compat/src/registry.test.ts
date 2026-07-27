import { describe, expect, it } from "vitest";

import {
  BUILTIN_EXTENSION_ADAPTER_MANIFESTS,
  BUILTIN_EXTENSION_ADAPTER_CONFORMANCE,
  ExtensionAdapterRegistryError,
  createExtensionAdapterRegistry
} from "./index.js";

function manifest(id = "verified-v1", versionRange = ">=1.0.0 <2.0.0") {
  return {
    schemaVersion: 1,
    id,
    package: "@verified/example",
    versionRange,
    commands: {
      inspect: { label: "Inspect", description: "Inspect verified state." },
      missing_command: { label: "Not loaded" }
    },
    tools: {
      read_artifact: { presentation: "read", label: "Read artifact" },
      missing_tool: { presentation: "generic" }
    }
  };
}

describe("Extension Adapter registry", () => {
  it("matches package and SemVer, then intersects only actually loaded surfaces", () => {
    const registry = createExtensionAdapterRegistry([manifest()]);
    const match = registry.match({
      package: "@verified/example",
      version: "1.4.2",
      commands: ["inspect", "runtime_only", "inspect"],
      tools: ["read_artifact", "runtime_only"]
    });

    expect(match).toEqual({
      adapterId: "verified-v1",
      schemaVersion: 1,
      package: "@verified/example",
      installedVersion: "1.4.2",
      versionRange: ">=1.0.0 <2.0.0",
      surfaces: ["commands", "tools"],
      commands: [{ name: "inspect", label: "Inspect", description: "Inspect verified state." }],
      tools: [{ name: "read_artifact", presentation: "read", label: "Read artifact" }]
    });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.manifests)).toBe(true);
    expect(Object.isFrozen(match)).toBe(true);
    expect(Object.isFrozen(match?.commands)).toBe(true);
    expect(Object.isFrozen(match?.commands[0])).toBe(true);
  });

  it("fails closed for package, version, range, or actual-surface mismatches", () => {
    const registry = createExtensionAdapterRegistry([manifest()]);

    expect(registry.match({ package: "other", version: "1.4.2", commands: ["inspect"] })).toBeUndefined();
    expect(registry.match({ package: "@verified/example", version: "2.0.0", commands: ["inspect"] })).toBeUndefined();
    expect(registry.match({ package: "@verified/example", version: "v1.4.2", commands: ["inspect"] })).toBeUndefined();
    expect(registry.match({ package: "@verified/example", version: "1.4.2", commands: ["runtime_only"] }))
      .toBeUndefined();
    expect(registry.match({ package: "@verified/example", version: "1.4.2", commands: ["bad command"] }))
      .toBeUndefined();
  });

  it("supports disjoint version manifests without arbitrary selection", () => {
    const registry = createExtensionAdapterRegistry([
      manifest("verified-v1", ">=1.0.0 <2.0.0"),
      manifest("verified-v2", ">=2.0.0 <3.0.0")
    ]);

    expect(registry.match({
      package: "@verified/example",
      version: "2.1.0",
      tools: ["read_artifact"]
    })?.adapterId).toBe("verified-v2");
  });

  it("rejects duplicate ids and overlapping package ranges", () => {
    expect(() => createExtensionAdapterRegistry([
      manifest("same", ">=1 <2"),
      { ...manifest("same", ">=2 <3"), package: "different" }
    ])).toThrowError(new ExtensionAdapterRegistryError("duplicate adapter id: same"));

    expect(() => createExtensionAdapterRegistry([
      manifest("first", ">=1 <3"),
      manifest("second", ">=2 <4")
    ])).toThrow(/adapter ranges overlap/u);
  });

  it("bounds registry construction before pairwise ambiguity checks", () => {
    expect(() => createExtensionAdapterRegistry(Array.from({ length: 513 }, () => manifest())))
      .toThrow("cannot exceed 512 manifests");
  });

  it("validates manifest input before constructing the registry", () => {
    expect(() => createExtensionAdapterRegistry([{ ...manifest(), html: "unsafe" }])).toThrow(/Invalid Extension Adapter/u);
  });

  it("exposes only source-pinned built-ins that passed conformance validation", () => {
    expect(BUILTIN_EXTENSION_ADAPTER_MANIFESTS).toHaveLength(2);
    expect(BUILTIN_EXTENSION_ADAPTER_MANIFESTS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "pi-rewind-0.5.0",
        package: "pi-rewind",
        versionRange: "0.5.0",
        commands: { rewind: expect.objectContaining({ label: "Rewind" }) },
        tools: {}
      }),
      expect.objectContaining({
        id: "feniix-pi-sequential-thinking-5.0.3",
        package: "@feniix/pi-sequential-thinking",
        versionRange: "5.0.3",
        commands: {},
        tools: expect.objectContaining({
          generate_summary: { presentation: "read", label: "Generate Thinking Summary" },
          clear_history: { presentation: "generic", label: "Clear Thought History" },
          get_thinking_status: { presentation: "read", label: "Get Thinking Status" }
        })
      })
    ]));
    const rewindEvidence = BUILTIN_EXTENSION_ADAPTER_CONFORMANCE.records
      .find((record) => record.evidence.package === "pi-rewind")?.evidence;
    expect(rewindEvidence).toMatchObject({
      package: "pi-rewind",
      installedVersion: "0.5.0",
      license: "MIT",
      sourceCommit: "91611ad87992fb7b635a41ba68f67916ff6e6ae3",
      commands: ["rewind"],
      tools: []
    });
    const sequentialEvidence = BUILTIN_EXTENSION_ADAPTER_CONFORMANCE.records
      .find((record) => record.evidence.package === "@feniix/pi-sequential-thinking")?.evidence;
    expect(sequentialEvidence).toMatchObject({
      installedVersion: "5.0.3",
      license: "MIT",
      sourceCommit: "36cf6ac5497b8cb75c7c7a34afe78c14b3584a61",
      commands: [],
      tools: [
        "process_thought",
        "generate_summary",
        "clear_history",
        "export_session",
        "import_session",
        "get_thinking_history",
        "get_thinking_status",
        "sequential_think"
      ]
    });
    expect(Object.isFrozen(BUILTIN_EXTENSION_ADAPTER_CONFORMANCE)).toBe(true);
    expect(Object.isFrozen(BUILTIN_EXTENSION_ADAPTER_MANIFESTS)).toBe(true);
  });
});
