import { describe, expect, it } from "vitest";

import {
  EXTENSION_ADAPTER_LIMITS,
  ExtensionAdapterManifestError,
  isValidInstalledExtensionVersion,
  parseExtensionAdapterManifest,
  validateExtensionAdapterManifest
} from "./index.js";

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "verified-example",
    package: "@verified/example",
    versionRange: ">=1.2.0 <2.0.0",
    commands: {
      inspect: { label: "Inspect", description: "Inspect the verified package." }
    },
    tools: {
      read_artifact: { presentation: "read", label: "Read artifact" }
    }
  };
}

function issueCodes(input: unknown): string[] {
  const result = validateExtensionAdapterManifest(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.issues.map((issue) => issue.code);
}

describe("Extension Adapter manifest v1", () => {
  it("accepts only canonical installed SemVer evidence", () => {
    expect(isValidInstalledExtensionVersion("1.2.3")).toBe(true);
    expect(isValidInstalledExtensionVersion("v1.2.3")).toBe(false);
    expect(isValidInstalledExtensionVersion("^1.2.3")).toBe(false);
  });

  it("parses a bounded data-only manifest and freezes the complete projection", () => {
    const manifest = parseExtensionAdapterManifest(validManifest());

    expect(manifest).toEqual(validManifest());
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.commands)).toBe(true);
    expect(Object.isFrozen(manifest.commands.inspect)).toBe(true);
    expect(Object.isFrozen(manifest.tools.read_artifact)).toBe(true);
    expect(() => {
      (manifest.commands.inspect as { label: string }).label = "mutated";
    }).toThrow();
  });

  it("accepts delegated as declarative presentation metadata", () => {
    const input = validManifest();
    input.tools = {
      delegate_task: { presentation: "delegated", label: "Delegate task" }
    };

    expect(parseExtensionAdapterManifest(input).tools.delegate_task).toEqual({
      presentation: "delegated",
      label: "Delegate task"
    });
  });

  it("requires the exact v1 root shape and at least one declared surface", () => {
    const missing = validManifest();
    delete missing.versionRange;
    expect(issueCodes(missing)).toContain("missing_field");

    const unknown = { ...validManifest(), settings: {} };
    expect(issueCodes(unknown)).toContain("unknown_field");

    const empty = { ...validManifest(), commands: {}, tools: {} };
    expect(issueCodes(empty)).toContain("empty_surface");

    expect(issueCodes({ ...validManifest(), schemaVersion: 2 })).toContain("invalid_value");
  });

  it.each(["html", "script", "javascript", "component", "react", "css", "module", "renderer", "code"])(
    "rejects the executable or renderer injection field %s",
    (field) => {
      const manifest = validManifest();
      manifest[field] = "untrusted";
      expect(issueCodes(manifest)).toContain("executable_field");
    }
  );

  it("rejects injection fields inside command and tool definitions", () => {
    const commandManifest = validManifest();
    commandManifest.commands = {
      inspect: { label: "Inspect", html: "<strong>unsafe</strong>" }
    };
    expect(issueCodes(commandManifest)).toContain("executable_field");

    const toolManifest = validManifest();
    toolManifest.tools = {
      read_artifact: { presentation: "read", component: "UnsafeComponent" }
    };
    expect(issueCodes(toolManifest)).toContain("executable_field");
  });

  it("rejects dangerous keys at every manifest depth", () => {
    const root = JSON.parse(`{
      "schemaVersion": 1,
      "id": "verified-example",
      "package": "verified-example",
      "versionRange": "1.x",
      "commands": {},
      "tools": {"read": {"presentation": "read"}},
      "__proto__": {"polluted": true}
    }`) as unknown;
    expect(issueCodes(root)).toContain("dangerous_key");

    const nested = JSON.parse(`{
      "schemaVersion": 1,
      "id": "verified-example",
      "package": "verified-example",
      "versionRange": "1.x",
      "commands": {},
      "tools": {"read": {"presentation": "read", "constructor": "unsafe"}}
    }`) as unknown;
    expect(issueCodes(nested)).toContain("dangerous_key");
  });

  it("rejects non-plain, accessor, cyclic, and non-finite input without invoking accessors", () => {
    expect(issueCodes(new Date())).toContain("not_json");
    expect(issueCodes({ ...validManifest(), commands: new Map() })).toContain("not_json");
    expect(issueCodes({ ...validManifest(), tools: ["read"] })).toContain("not_json");
    expect(issueCodes({ ...validManifest(), schemaVersion: Number.NaN })).toContain("not_json");

    let getterCalls = 0;
    const accessor = validManifest();
    Object.defineProperty(accessor, "payload", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "unsafe";
      }
    });
    expect(issueCodes(accessor)).toContain("not_json");
    expect(getterCalls).toBe(0);

    const cyclic = validManifest();
    cyclic.cycle = cyclic;
    expect(issueCodes(cyclic)).toContain("not_json");
  });

  it("enforces byte, depth, entry-count, and field-length bounds", () => {
    const oversized = validManifest();
    for (let index = 0; index < 100; index += 1) oversized[`padding_${index}`] = "x".repeat(400);
    expect(issueCodes(oversized)).toContain("too_large");

    const deep = validManifest();
    let cursor = deep;
    for (let index = 0; index < EXTENSION_ADAPTER_LIMITS.jsonDepth + 2; index += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    expect(issueCodes(deep)).toContain("too_deep");

    const tooManyCommands = validManifest();
    tooManyCommands.commands = Object.fromEntries(
      Array.from({ length: EXTENSION_ADAPTER_LIMITS.commands + 1 }, (_, index) => [`command_${index}`, { label: "Run" }])
    );
    expect(issueCodes(tooManyCommands)).toContain("too_many_entries");

    expect(issueCodes({
      ...validManifest(),
      id: "x".repeat(EXTENSION_ADAPTER_LIMITS.adapterIdCharacters + 1)
    })).toContain("invalid_value");
  });

  it.each([
    ["invalid adapter id", { id: "Invalid Adapter" }],
    ["invalid package name", { package: "INVALID/Package" }],
    ["invalid SemVer range", { versionRange: "latest" }],
    ["invalid command name", { commands: { "bad command": { label: "Bad" } } }],
    ["invalid tool presentation", { tools: { read: { presentation: "html" } } }],
    ["missing command label", { commands: { inspect: { description: "Missing label" } } }]
  ])("rejects %s", (_label, override) => {
    expect(issueCodes({ ...validManifest(), ...override })).toContain("invalid_value");
  });

  it("returns immutable issues and exposes the same issues from the throwing parser", () => {
    const result = validateExtensionAdapterManifest({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(Object.isFrozen(result.issues[0])).toBe(true);

    expect(() => parseExtensionAdapterManifest({})).toThrow(ExtensionAdapterManifestError);
    try {
      parseExtensionAdapterManifest({});
    } catch (error) {
      expect(error).toBeInstanceOf(ExtensionAdapterManifestError);
      expect((error as ExtensionAdapterManifestError).issues).toEqual(result.issues);
    }
  });
});
