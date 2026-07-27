import { describe, expect, it } from "vitest";

import {
  ExtensionAdapterConformanceError,
  createExtensionAdapterConformanceInventory,
  verifyExtensionAdapterConformance
} from "./conformance.js";

const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function manifest() {
  return {
    schemaVersion: 1,
    id: "verified-example-v1",
    package: "@verified/example",
    versionRange: ">=1.0.0 <2.0.0",
    commands: {
      inspect: { label: "Inspect" }
    },
    tools: {
      read_artifact: { presentation: "read" }
    }
  };
}

function evidence() {
  return {
    schemaVersion: 2,
    adapterId: "verified-example-v1",
    package: "@verified/example",
    installedVersion: "1.4.2",
    packageIntegrity: "sha512-YWJjZA==",
    license: "MIT",
    sourceRepository: "https://github.com/verified/example",
    sourceCommit: SOURCE_COMMIT,
    sourcePaths: ["src/index.ts", "src/extension.ts"],
    commands: ["inspect", "runtime_only"],
    tools: ["read_artifact", "runtime_only"]
  };
}

describe("Extension Adapter conformance", () => {
  it("creates an immutable inventory only from source-pinned, observed surfaces", () => {
    const inventory = createExtensionAdapterConformanceInventory([{ manifest: manifest(), evidence: evidence() }]);

    expect(inventory.manifests).toEqual([manifest()]);
    expect(inventory.records[0]?.evidence).toEqual(evidence());
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory.records)).toBe(true);
    expect(Object.isFrozen(inventory.records[0])).toBe(true);
    expect(Object.isFrozen(inventory.records[0]?.evidence.commands)).toBe(true);
  });

  it("rejects identity, version and observed-surface mismatches", () => {
    expect(() => verifyExtensionAdapterConformance({
      manifest: manifest(),
      evidence: { ...evidence(), adapterId: "other" }
    })).toThrow("adapterId does not match");
    expect(() => verifyExtensionAdapterConformance({
      manifest: manifest(),
      evidence: { ...evidence(), package: "@verified/other" }
    })).toThrow("package does not match");
    expect(() => verifyExtensionAdapterConformance({
      manifest: manifest(),
      evidence: { ...evidence(), installedVersion: "2.0.0" }
    })).toThrow("does not satisfy");
    expect(() => verifyExtensionAdapterConformance({
      manifest: manifest(),
      evidence: { ...evidence(), tools: ["runtime_only"] }
    })).toThrow("unobserved tool surfaces: read_artifact");
  });

  it("requires canonical repository, revision, path and unique surface evidence", () => {
    const invalidEvidence = [
      { ...evidence(), sourceRepository: "http://github.com/verified/example" },
      { ...evidence(), sourceRepository: "https://user@example.com/verified/example" },
      { ...evidence(), packageIntegrity: "sha256-not-supported" },
      { ...evidence(), sourceCommit: "0123456" },
      { ...evidence(), sourceCommit: SOURCE_COMMIT.toUpperCase() },
      { ...evidence(), sourcePaths: ["../src/extension.ts"] },
      { ...evidence(), sourcePaths: ["src\\extension.ts"] },
      { ...evidence(), sourcePaths: ["src/extension.ts", "src/extension.ts"] },
      { ...evidence(), commands: ["inspect", "inspect"] }
    ];

    for (const item of invalidEvidence) {
      expect(() => verifyExtensionAdapterConformance({ manifest: manifest(), evidence: item }))
        .toThrow(ExtensionAdapterConformanceError);
    }
  });

  it("reuses registry ambiguity checks across conforming records", () => {
    expect(() => createExtensionAdapterConformanceInventory([
      { manifest: manifest(), evidence: evidence() },
      {
        manifest: { ...manifest(), id: "verified-example-overlap", versionRange: ">=1.2.0 <3.0.0" },
        evidence: { ...evidence(), adapterId: "verified-example-overlap" }
      }
    ])).toThrow(/adapter ranges overlap/u);
  });

  it("bounds conformance inventory construction", () => {
    const bundle = { manifest: manifest(), evidence: evidence() };
    expect(() => createExtensionAdapterConformanceInventory(Array.from({ length: 513 }, () => bundle)))
      .toThrow("cannot exceed 512 records");
  });

  it("rejects unknown evidence fields instead of silently widening the contract", () => {
    expect(() => verifyExtensionAdapterConformance({
      manifest: manifest(),
      evidence: { ...evidence(), html: "<div />" }
    })).toThrow("unknown field html");

    const accessorEvidence = evidence();
    Object.defineProperty(accessorEvidence, "sourcePaths", {
      enumerable: true,
      get: () => ["src/extension.ts"]
    });
    expect(() => verifyExtensionAdapterConformance({ manifest: manifest(), evidence: accessorEvidence }))
      .toThrow("must be an enumerable data field");
  });
});
