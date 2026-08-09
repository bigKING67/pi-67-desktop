import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import { createExtensionAdapterRegistry } from "@pi67/extension-compat";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectExtensionAdapterProjection,
  type ExtensionAdapterCommandSource,
  type ExtensionAdapterProjectionSource,
  type ExtensionAdapterSessionSource,
  type ExtensionAdapterToolSource
} from "./extension-adapter-projection.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Extension Adapter runtime projection", () => {
  it("matches resolved commands and only the final effective tool owner", async () => {
    const alpha = await packageExtension("@verified/alpha", "1.2.3");
    const beta = await packageExtension("@verified/beta", "2.1.0");
    const commands: ExtensionAdapterCommandSource[] = [
      resolvedCommand("duplicate:1", alpha.sourceInfo),
      resolvedCommand("duplicate:2", beta.sourceInfo)
    ];
    const finalTools: ExtensionAdapterToolSource[] = [
      { name: "shared_tool", sourceInfo: cloneSourceInfo(beta.sourceInfo) },
      { name: "alpha_only", sourceInfo: cloneSourceInfo(alpha.sourceInfo) }
    ];
    const registry = createExtensionAdapterRegistry([
      manifest("alpha-adapter", "@verified/alpha", ">=1 <2", {
        commands: { "duplicate:1": { label: "Alpha command" } },
        tools: {
          shared_tool: { presentation: "generic" },
          alpha_only: { presentation: "read", label: "Alpha artifact" }
        }
      }),
      manifest("beta-adapter", "@verified/beta", ">=2 <3", {
        commands: { "duplicate:2": { label: "Beta command" } },
        tools: { shared_tool: { presentation: "command", label: "Beta command tool" } }
      })
    ]);

    const projection = await projectExtensionAdapterProjection(
      projectionSource([alpha.extension, beta.extension], commands),
      sessionSource(finalTools),
      registry
    );

    expect(projection.activeAdapterCount).toBe(2);
    expect(projection.matchesByExtension.get(alpha.extensionPath)).toMatchObject({
      adapterId: "alpha-adapter",
      commands: [{ name: "duplicate:1", label: "Alpha command" }],
      tools: [{ name: "alpha_only", presentation: "read", label: "Alpha artifact" }]
    });
    expect(projection.matchesByExtension.get(beta.extensionPath)).toMatchObject({
      adapterId: "beta-adapter",
      commands: [{ name: "duplicate:2", label: "Beta command" }],
      tools: [{ name: "shared_tool", presentation: "command", label: "Beta command tool" }]
    });
    expect(projection.effectiveTools.get("shared_tool")).toEqual({
      adapterId: "beta-adapter",
      package: "@verified/beta",
      presentation: "command",
      label: "Beta command tool"
    });
    expect(projection.effectiveCommands.get("duplicate:1")).toEqual({
      adapterId: "alpha-adapter",
      package: "@verified/alpha",
      label: "Alpha command"
    });
    expect(projection.effectiveTools.has("alpha_only")).toBe(true);
    expect(Object.isFrozen(projection.effectiveTools.get("shared_tool"))).toBe(true);
    expect(() => (projection.effectiveTools as Map<string, unknown>).set("mutated", {})).toThrow(TypeError);
  });

  it("fails closed for ambiguous final tools and non-package extension identity", async () => {
    const packaged = await packageExtension("@verified/example", "1.4.0");
    const topLevel = {
      ...packaged.extension,
      resolvedPath: `${packaged.extensionPath}.top-level`,
      path: `${packaged.extensionPath}.top-level`,
      sourceInfo: {
        path: `${packaged.extensionPath}.top-level`,
        source: packaged.sourceInfo.source,
        scope: packaged.sourceInfo.scope,
        origin: "top-level" as const
      }
    };
    await writeFile(topLevel.path, "export default {};", "utf8");
    const duplicateTools: ExtensionAdapterToolSource[] = [
      { name: "inspect", sourceInfo: packaged.sourceInfo },
      { name: "inspect", sourceInfo: cloneSourceInfo(packaged.sourceInfo) }
    ];
    const registry = createExtensionAdapterRegistry([
      manifest("verified", "@verified/example", "1.x", {
        commands: {},
        tools: { inspect: { presentation: "generic" } }
      })
    ]);

    const projection = await projectExtensionAdapterProjection(
      projectionSource([packaged.extension, topLevel], []),
      sessionSource(duplicateTools),
      registry
    );

    expect(projection.activeAdapterCount).toBe(0);
    expect(projection.matchesByExtension.size).toBe(0);
    expect(projection.effectiveCommands.size).toBe(0);
    expect(projection.effectiveTools.size).toBe(0);
  });

  it("projects delegated semantics only from a matched package Adapter", async () => {
    const packaged = await packageExtension("@verified/delegation", "1.0.0");
    const registry = createExtensionAdapterRegistry([
      manifest("verified-delegation", "@verified/delegation", "1.0.0", {
        commands: {},
        tools: { delegate_task: { presentation: "delegated", label: "Delegate task" } }
      })
    ]);

    const projection = await projectExtensionAdapterProjection(
      projectionSource([packaged.extension], []),
      sessionSource([{ name: "delegate_task", sourceInfo: cloneSourceInfo(packaged.sourceInfo) }]),
      registry
    );

    expect(projection.effectiveTools.get("delegate_task")).toEqual({
      adapterId: "verified-delegation",
      package: "@verified/delegation",
      presentation: "delegated",
      label: "Delegate task"
    });
  });

  it("keeps the production empty built-in registry at zero without reading runtime surfaces", async () => {
    const packaged = await packageExtension("@verified/example", "1.0.0");
    let commandReads = 0;
    let toolReads = 0;
    const source: ExtensionAdapterProjectionSource = {
      extensions: [packaged.extension],
      runtime: {
        getCommands: () => {
          commandReads += 1;
          return [];
        }
      }
    };
    const session: ExtensionAdapterSessionSource = {
      getAllTools: () => {
        toolReads += 1;
        return [];
      }
    };

    const projection = await projectExtensionAdapterProjection(
      source,
      session,
      createExtensionAdapterRegistry([])
    );

    expect(projection).toMatchObject({ activeAdapterCount: 0 });
    expect(commandReads).toBe(0);
    expect(toolReads).toBe(0);
  });
});

interface PackageExtensionFixture {
  readonly extensionPath: string;
  readonly sourceInfo: SourceInfo;
  readonly extension: {
    readonly path: string;
    readonly resolvedPath: string;
    readonly sourceInfo: SourceInfo;
  };
}

async function packageExtension(name: string, version: string): Promise<PackageExtensionFixture> {
  const root = await mkdtemp(join(tmpdir(), "pi67-adapter-projection-"));
  roots.push(root);
  const baseDir = join(root, "package");
  const extensionPath = join(baseDir, "extension.ts");
  await mkdir(baseDir);
  await Promise.all([
    writeFile(join(baseDir, "package.json"), JSON.stringify({ name, version }), "utf8"),
    writeFile(extensionPath, "export default {};", "utf8")
  ]);
  const sourceInfo: SourceInfo = {
    path: extensionPath,
    source: `npm:${name}@${version}`,
    scope: "user",
    origin: "package",
    baseDir
  };
  return {
    extensionPath,
    sourceInfo,
    extension: { path: extensionPath, resolvedPath: extensionPath, sourceInfo }
  };
}

function projectionSource(
  extensions: ExtensionAdapterProjectionSource["extensions"],
  commands: readonly ExtensionAdapterCommandSource[]
): ExtensionAdapterProjectionSource {
  return { extensions, runtime: { getCommands: () => commands } };
}

function sessionSource(tools: readonly ExtensionAdapterToolSource[]): ExtensionAdapterSessionSource {
  return { getAllTools: () => tools };
}

function resolvedCommand(name: string, sourceInfo: SourceInfo): ExtensionAdapterCommandSource {
  return { name, source: "extension", sourceInfo: cloneSourceInfo(sourceInfo) };
}

function cloneSourceInfo(sourceInfo: SourceInfo): SourceInfo {
  return { ...sourceInfo };
}

function manifest(
  id: string,
  packageName: string,
  versionRange: string,
  surfaces: {
    commands: Record<string, { label: string }>;
    tools: Record<string, {
      presentation: "generic" | "command" | "read" | "change" | "delegated";
      label?: string;
    }>;
  }
): unknown {
  return {
    schemaVersion: 1,
    id,
    package: packageName,
    versionRange,
    commands: surfaces.commands,
    tools: surfaces.tools
  };
}
