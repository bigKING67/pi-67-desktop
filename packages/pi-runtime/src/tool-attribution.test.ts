import type { SourceInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ToolAdapterView } from "./extension-adapter-projection.js";
import {
  TOOL_ATTRIBUTION_LIMITS,
  ToolAttributionRegistry,
  type ToolAttributionSource
} from "./tool-attribution.js";

describe("ToolAttributionRegistry", () => {
  it("freezes the start-time adapter and completes by toolCallId without name recomputation", () => {
    const registry = new ToolAttributionRegistry();
    const source = mutableAdapter("verified", "Initial label");
    const runtimeTools = [extensionTool("inspect")];
    registry.replaceEffectiveTools(7, runtimeTools, new Map([["inspect", source]]));

    const started = registry.bindToolExecutionStart(7, "call-1", "inspect", runtimeTools);
    source.label = "Mutated outside registry";
    expect(registry.bindToolExecutionStart(7, "call-1", "other_tool", [])).toBe(started);
    expect(registry.completeToolExecution(7, "call-1")).toEqual({
      toolName: "inspect",
      toolKind: "read",
      adapter: {
        adapterId: "verified",
        package: "@verified/example",
        presentation: "read",
        label: "Initial label"
      }
    });
    expect(Object.isFrozen(started)).toBe(true);
    expect(Object.isFrozen(started?.adapter)).toBe(true);
    expect(registry.peekToolExecution(7, "call-1")).toBe(started);
    expect(registry.completeToolExecution(7, "call-1")).toBe(started);
    expect(registry.settledBindingCount).toBe(1);
  });

  it("clears bindings on reload, generation replacement, and explicit reset", () => {
    const registry = new ToolAttributionRegistry();
    const runtimeTools = [extensionTool("inspect")];
    registry.replaceEffectiveTools(2, runtimeTools, tools("inspect"));
    expect(registry.bindToolExecutionStart(2, "reload-call", "inspect", runtimeTools)).toBeDefined();

    registry.replaceEffectiveTools(2, runtimeTools, tools("inspect"));
    expect(registry.completeToolExecution(2, "reload-call")).toBeUndefined();
    expect(registry.bindToolExecutionStart(2, "generation-call", "inspect", runtimeTools)).toBeDefined();

    registry.replaceEffectiveTools(3, runtimeTools, tools("inspect"));
    expect(registry.peekToolExecution(2, "generation-call")).toBeUndefined();
    expect(registry.bindToolExecutionStart(2, "stale-call", "inspect", runtimeTools)).toBeUndefined();
    expect(registry.bindToolExecutionStart(3, "current-call", "inspect", runtimeTools)).toBeDefined();

    registry.reset();
    expect(registry.activeBindingCount).toBe(0);
    expect(registry.settledBindingCount).toBe(0);
    expect(registry.completeToolExecution(3, "current-call")).toBeUndefined();
  });

  it("fails closed to generic when current provenance is unknown or does not match the Adapter", () => {
    const registry = new ToolAttributionRegistry();
    const adapted = extensionTool("adapted");
    const plain = extensionTool("plain", "unadapted");
    registry.replaceEffectiveTools(1, [adapted], tools("adapted"));

    expect(registry.bindToolExecutionStart(1, "plain-call", "plain", [plain])).toEqual({
      toolName: "plain",
      toolKind: "generic"
    });
    expect(registry.completeToolExecution(1, "plain-call")).toEqual({
      toolName: "plain",
      toolKind: "generic"
    });
    expect(registry.bindToolExecutionStart(1, "override-call", "adapted", [
      extensionTool("adapted", "override")
    ])).toEqual({ toolName: "adapted", toolKind: "generic" });
    expect(registry.bindToolExecutionStart(-1, "invalid-generation", "adapted", [adapted])).toBeUndefined();
    expect(registry.bindToolExecutionStart(1, "bad\ncall", "adapted", [adapted])).toBeUndefined();
  });

  it("classifies only a provenance-matched delegated Adapter as delegated work", () => {
    const registry = new ToolAttributionRegistry();
    const verified = extensionTool("delegate_task", "delegation");
    registry.replaceEffectiveTools(8, [verified], new Map([
      ["delegate_task", adapter("verified-delegation", "delegated")]
    ]));

    expect(registry.bindToolExecutionStart(8, "verified-call", "delegate_task", [verified])).toMatchObject({
      toolName: "delegate_task",
      toolKind: "subagent",
      adapter: { presentation: "delegated" }
    });
    expect(registry.bindToolExecutionStart(
      8,
      "same-name-unverified",
      "subagent",
      [extensionTool("subagent", "unverified")]
    )).toEqual({
      toolName: "subagent",
      toolKind: "generic"
    });
  });

  it("classifies only provenance-confirmed Pi built-ins by their reserved names", () => {
    const registry = new ToolAttributionRegistry();
    registry.replaceEffectiveTools(5, [], new Map());

    const expected = new Map([
      ["read", "read"],
      ["grep", "search"],
      ["find", "search"],
      ["ls", "search"],
      ["edit", "edit"],
      ["write", "edit"],
      ["bash", "shell"]
    ] as const);
    for (const [toolName, toolKind] of expected) {
      expect(registry.bindToolExecutionStart(
        5,
        `builtin-${toolName}`,
        toolName,
        [builtinTool(toolName)]
      )).toEqual({ toolName, toolKind });
    }

    expect(registry.bindToolExecutionStart(5, "extension-bash", "bash", [extensionTool("bash")])).toEqual({
      toolName: "bash",
      toolKind: "generic"
    });
    expect(registry.bindToolExecutionStart(5, "extension-read", "read", [extensionTool("read")])).toEqual({
      toolName: "read",
      toolKind: "generic"
    });
    expect(registry.bindToolExecutionStart(5, "sdk-edit", "edit", [sdkTool("edit")])).toEqual({
      toolName: "edit",
      toolKind: "generic"
    });
    expect(registry.bindToolExecutionStart(5, "sdk-web-search", "WebSearch", [sdkTool("WebSearch")])).toEqual({
      toolName: "WebSearch",
      toolKind: "search"
    });
    expect(registry.bindToolExecutionStart(5, "sdk-web-fetch", "web_fetch", [sdkTool("web_fetch")])).toEqual({
      toolName: "web_fetch",
      toolKind: "search"
    });
  });

  it("bounds effective tools and simultaneous tool-call bindings", () => {
    const registry = new ToolAttributionRegistry();
    const effectiveTools = new Map<string, ToolAdapterView>();
    const runtimeTools: ToolAttributionSource[] = [];
    for (let index = 0; index <= TOOL_ATTRIBUTION_LIMITS.effectiveTools; index += 1) {
      effectiveTools.set(`tool_${index}`, adapter("verified"));
      runtimeTools.push(extensionTool(`tool_${index}`));
    }
    registry.replaceEffectiveTools(9, runtimeTools, effectiveTools);

    expect(registry.bindToolExecutionStart(
      9,
      "tool-outside-projected-bound",
      `tool_${TOOL_ATTRIBUTION_LIMITS.effectiveTools}`,
      runtimeTools
    )).toEqual({
      toolName: `tool_${TOOL_ATTRIBUTION_LIMITS.effectiveTools}`,
      toolKind: "generic"
    });
    registry.completeToolExecution(9, "tool-outside-projected-bound");

    for (let index = 0; index < TOOL_ATTRIBUTION_LIMITS.activeToolCalls; index += 1) {
      expect(registry.bindToolExecutionStart(
        9,
        `call_${index}`,
        `tool_${index}`,
        runtimeTools
      )).toBeDefined();
    }
    expect(registry.activeBindingCount).toBe(TOOL_ATTRIBUTION_LIMITS.activeToolCalls);
    expect(registry.bindToolExecutionStart(9, "overflow", "tool_0", runtimeTools)).toBeUndefined();

    const oversizedRuntime = Array.from(
      { length: TOOL_ATTRIBUTION_LIMITS.runtimeTools + 1 },
      (_, index) => extensionTool(`oversized_${index}`)
    );
    const oversizedRegistry = new ToolAttributionRegistry();
    oversizedRegistry.replaceEffectiveTools(10, oversizedRuntime, new Map([
      ["oversized_0", adapter("verified")]
    ]));
    expect(oversizedRegistry.bindToolExecutionStart(
      10,
      "oversized-call",
      "oversized_0",
      oversizedRuntime
    )).toEqual({ toolName: "oversized_0", toolKind: "generic" });
  });

  it("keeps only a bounded settled attribution window for transcript projection", () => {
    const registry = new ToolAttributionRegistry();
    const runtimeTools = [extensionTool("inspect")];
    registry.replaceEffectiveTools(4, runtimeTools, tools("inspect"));
    for (let index = 0; index <= TOOL_ATTRIBUTION_LIMITS.settledToolCalls; index += 1) {
      const toolCallId = `settled_${index}`;
      expect(registry.bindToolExecutionStart(4, toolCallId, "inspect", runtimeTools)).toBeDefined();
      expect(registry.completeToolExecution(4, toolCallId)).toBeDefined();
    }

    expect(registry.settledBindingCount).toBe(TOOL_ATTRIBUTION_LIMITS.settledToolCalls);
    expect(registry.peekToolExecution(4, "settled_0")).toBeUndefined();
    expect(registry.peekToolExecution(4, `settled_${TOOL_ATTRIBUTION_LIMITS.settledToolCalls}`)).toBeDefined();
  });

  it("settles any unmatched active calls when the agent turn terminates", () => {
    const registry = new ToolAttributionRegistry();
    const runtimeTools = [extensionTool("inspect")];
    registry.replaceEffectiveTools(6, runtimeTools, tools("inspect"));
    registry.bindToolExecutionStart(6, "unfinished", "inspect", runtimeTools);

    registry.settleActiveToolExecutions(6);

    expect(registry.activeBindingCount).toBe(0);
    expect(registry.settledBindingCount).toBe(1);
    expect(registry.peekToolExecution(6, "unfinished")).toBeDefined();
  });
});

function tools(name: string): ReadonlyMap<string, ToolAdapterView> {
  return new Map([[name, adapter("verified")]]);
}

function adapter(
  adapterId: string,
  presentation: ToolAdapterView["presentation"] = "read"
): ToolAdapterView {
  return {
    adapterId,
    package: "@verified/example",
    presentation,
    label: "Verified tool"
  };
}

function mutableAdapter(adapterId: string, label: string): ToolAdapterView & { label: string } {
  return {
    ...adapter(adapterId),
    label
  };
}

function builtinTool(name: string): ToolAttributionSource {
  return {
    name,
    sourceInfo: {
      path: `<builtin:${name}>`,
      source: "builtin",
      scope: "temporary",
      origin: "top-level"
    }
  };
}

function extensionTool(name: string, extensionId = "example"): ToolAttributionSource {
  const baseDir = `/extensions/${extensionId}`;
  return {
    name,
    sourceInfo: extensionSourceInfo(baseDir, `@verified/${extensionId}`)
  };
}

function sdkTool(name: string): ToolAttributionSource {
  return {
    name,
    sourceInfo: {
      path: `<sdk:${name}>`,
      source: "sdk",
      scope: "temporary",
      origin: "top-level"
    }
  };
}

function extensionSourceInfo(baseDir: string, packageName: string): SourceInfo {
  return {
    path: `${baseDir}/extension.ts`,
    source: `npm:${packageName}@1.0.0`,
    scope: "user",
    origin: "package",
    baseDir
  };
}
