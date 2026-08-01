import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSession,
  Extension,
  LoadExtensionsResult,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import { createExtensionAdapterRegistry } from "@pi67/extension-compat";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionAdapterRuntime } from "./extension-adapter-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ExtensionAdapterRuntime", () => {
  it("keeps catalog, commands, capabilities, and settled Tool attribution on one generation", async () => {
    const fixture = await packageExtension();
    const runtime = new ExtensionAdapterRuntime(createExtensionAdapterRegistry([{
      schemaVersion: 1,
      id: "verified-adapter",
      package: "@verified/example",
      versionRange: ">=1 <2",
      commands: { inspect: { label: "检查" } },
      tools: { read_artifact: { presentation: "read", label: "读取制品" } }
    }]));

    expect(await runtime.refresh(3, fixture.extensions, fixture.session)).toBe(true);
    expect(runtime.getCapabilities().adapterRegistry).toMatchObject({
      available: true,
      activeAdapterCount: 1,
      supportedSurfaces: ["commands", "tools"],
      realtimeUiAttribution: false
    });
    expect(runtime.getCatalog().items[0]).toMatchObject({
      adapter: { adapterId: "verified-adapter", commandCount: 1, toolCount: 1 },
      assessment: { overall: "adapter" }
    });
    expect(runtime.getCommands()).toEqual({
      items: [{
        name: "inspect",
        source: "extension",
        description: "Inspect runtime",
        adapter: {
          adapterId: "verified-adapter",
          package: "@verified/example",
          label: "检查"
        }
      }],
      total: 1,
      truncated: false
    });

    const runtimeTools = fixture.session.getAllTools();
    expect(runtime.bindToolExecutionStart(3, "call-1", "read_artifact", runtimeTools)).toBe("read");
    runtime.completeToolExecution(3, "call-1");
    expect(runtime.getToolAdapter(3, "call-1")).toEqual({
      adapterId: "verified-adapter",
      package: "@verified/example",
      presentation: "read",
      label: "读取制品"
    });
    expect(runtime.bindToolExecutionStart(3, "extension-bash", "bash", runtimeTools)).toBe("generic");

    runtime.reset();
    expect(runtime.getCapabilities().adapterRegistry.activeAdapterCount).toBe(0);
    expect(runtime.getCatalog()).toEqual({ items: [], total: 0, truncated: false });
    expect(runtime.getCommands()).toEqual({ items: [], total: 0, truncated: false });
    expect(runtime.getToolAdapter(3, "call-1")).toBeUndefined();
  });

  it("activates the source-pinned pi-rewind built-in without claiming its shortcut is desktop-native", async () => {
    const fixture = await packageRewindExtension();
    const runtime = new ExtensionAdapterRuntime();

    expect(await runtime.refresh(1, fixture.extensions, fixture.session)).toBe(true);
    expect(runtime.getCapabilities().adapterRegistry.activeAdapterCount).toBe(1);
    expect(runtime.getCommands()).toEqual({
      items: [{
        name: "rewind",
        source: "extension",
        description: "Rewind file changes and/or conversation to a checkpoint",
        adapter: {
          adapterId: "pi-rewind-0.5.0",
          package: "pi-rewind",
          label: "Rewind",
          description: "Restore files and/or conversation to a checkpoint."
        }
      }],
      total: 1,
      truncated: false
    });
    expect(runtime.getCatalog().items[0]).toMatchObject({
      adapter: {
        adapterId: "pi-rewind-0.5.0",
        installedVersion: "0.5.0",
        commandCount: 1,
        toolCount: 0
      },
      assessment: {
        overall: "partial",
        surfaces: [
          { surface: "commands", status: "supported" },
          { surface: "tools", status: "not-present" },
          { surface: "ui-primitives", status: "unknown" },
          { surface: "tui-custom", status: "tui-only" }
        ]
      }
    });
  });

  it("activates the source-pinned sequential-thinking tools without inventing command or change surfaces", async () => {
    const fixture = await packageSequentialThinkingExtension();
    const runtime = new ExtensionAdapterRuntime();

    expect(await runtime.refresh(2, fixture.extensions, fixture.session)).toBe(true);
    expect(runtime.getCapabilities().adapterRegistry.activeAdapterCount).toBe(1);
    expect(runtime.getCommands()).toEqual({ items: [], total: 0, truncated: false });
    expect(runtime.getCatalog().items[0]).toMatchObject({
      adapter: {
        adapterId: "feniix-pi-sequential-thinking-5.0.3",
        installedVersion: "5.0.3",
        commandCount: 0,
        toolCount: 8
      },
      assessment: {
        overall: "adapter",
        surfaces: [
          { surface: "commands", status: "not-present" },
          { surface: "tools", status: "supported" },
          { surface: "ui-primitives", status: "unknown" },
          { surface: "tui-custom", status: "unknown" }
        ]
      }
    });

    const runtimeTools = fixture.session.getAllTools();
    expect(runtime.bindToolExecutionStart(2, "summary-call", "generate_summary", runtimeTools)).toBe("read");
    expect(runtime.getToolAdapter(2, "summary-call")).toEqual({
      adapterId: "feniix-pi-sequential-thinking-5.0.3",
      package: "@feniix/pi-sequential-thinking",
      presentation: "read",
      label: "Generate Thinking Summary"
    });
    expect(runtime.bindToolExecutionStart(2, "history-call", "get_thinking_history", runtimeTools)).toBe("read");
    expect(runtime.bindToolExecutionStart(2, "status-call", "get_thinking_status", runtimeTools)).toBe("read");
    for (const toolName of [
      "process_thought",
      "clear_history",
      "export_session",
      "import_session",
      "sequential_think"
    ]) {
      expect(runtime.bindToolExecutionStart(2, `${toolName}-call`, toolName, runtimeTools)).toBe("generic");
    }
  });
});

async function packageExtension(): Promise<{
  extensions: LoadExtensionsResult;
  session: AgentSession;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi67-adapter-runtime-"));
  roots.push(root);
  const baseDir = join(root, "package");
  const extensionPath = join(baseDir, "extension.ts");
  await mkdir(baseDir);
  await Promise.all([
    writeFile(join(baseDir, "package.json"), JSON.stringify({ name: "@verified/example", version: "1.2.3" })),
    writeFile(extensionPath, "export default {};", "utf8")
  ]);
  const sourceInfo: SourceInfo = {
    path: extensionPath,
    source: "npm:@verified/example@1.2.3",
    scope: "user",
    origin: "package",
    baseDir
  };
  const extension = {
    path: extensionPath,
    resolvedPath: extensionPath,
    sourceInfo,
    hidden: false,
    commands: new Map([["inspect", {}]]),
    tools: new Map([["read_artifact", {}]]),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    shortcuts: new Map()
  } as unknown as Extension;
  const extensions = {
    extensions: [extension],
    errors: [],
    runtime: {
      getCommands: () => [{
        name: "inspect",
        description: "Inspect runtime",
        source: "extension",
        sourceInfo
      }]
    }
  } as unknown as LoadExtensionsResult;
  const session = {
    getAllTools: () => [
      { name: "read_artifact", sourceInfo },
      { name: "bash", sourceInfo }
    ]
  } as unknown as AgentSession;
  return { extensions, session };
}

async function packageRewindExtension(): Promise<{
  extensions: LoadExtensionsResult;
  session: AgentSession;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi67-rewind-adapter-runtime-"));
  roots.push(root);
  const baseDir = join(root, "package");
  const extensionPath = join(baseDir, "src", "index.ts");
  await mkdir(join(baseDir, "src"), { recursive: true });
  await Promise.all([
    writeFile(join(baseDir, "package.json"), JSON.stringify({ name: "pi-rewind", version: "0.5.0" })),
    writeFile(extensionPath, "export default {};", "utf8")
  ]);
  const sourceInfo: SourceInfo = {
    path: extensionPath,
    source: "npm:pi-rewind@0.5.0",
    scope: "user",
    origin: "package",
    baseDir
  };
  const extension = {
    path: extensionPath,
    resolvedPath: extensionPath,
    sourceInfo,
    hidden: false,
    commands: new Map([["rewind", {}]]),
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    shortcuts: new Map([["escape escape", {}]])
  } as unknown as Extension;
  const extensions = {
    extensions: [extension],
    errors: [],
    runtime: {
      getCommands: () => [{
        name: "rewind",
        description: "Rewind file changes and/or conversation to a checkpoint",
        source: "extension",
        sourceInfo
      }]
    }
  } as unknown as LoadExtensionsResult;
  const session = { getAllTools: () => [] } as unknown as AgentSession;
  return { extensions, session };
}

async function packageSequentialThinkingExtension(): Promise<{
  extensions: LoadExtensionsResult;
  session: AgentSession;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi67-sequential-thinking-adapter-runtime-"));
  roots.push(root);
  const baseDir = join(root, "package");
  const extensionPath = join(baseDir, "extensions", "index.ts");
  await mkdir(join(baseDir, "extensions"), { recursive: true });
  await Promise.all([
    writeFile(join(baseDir, "package.json"), JSON.stringify({
      name: "@feniix/pi-sequential-thinking",
      version: "5.0.3"
    })),
    writeFile(extensionPath, "export default {};", "utf8")
  ]);
  const sourceInfo: SourceInfo = {
    path: extensionPath,
    source: "npm:@feniix/pi-sequential-thinking@5.0.3",
    scope: "user",
    origin: "package",
    baseDir
  };
  const toolNames = [
    "process_thought",
    "generate_summary",
    "clear_history",
    "export_session",
    "import_session",
    "get_thinking_history",
    "get_thinking_status",
    "sequential_think"
  ];
  const extension = {
    path: extensionPath,
    resolvedPath: extensionPath,
    sourceInfo,
    hidden: false,
    commands: new Map(),
    tools: new Map(toolNames.map((name) => [name, {}])),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    shortcuts: new Map()
  } as unknown as Extension;
  const extensions = {
    extensions: [extension],
    errors: [],
    runtime: { getCommands: () => [] }
  } as unknown as LoadExtensionsResult;
  const session = {
    getAllTools: () => toolNames.map((name) => ({ name, sourceInfo }))
  } as unknown as AgentSession;
  return { extensions, session };
}
