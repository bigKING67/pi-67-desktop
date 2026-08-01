import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

type SafetyHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { hasUI: boolean }
) => Promise<{ block?: boolean; reason?: string } | undefined>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("createDesktopSafetyExtension configured capabilities", () => {
  it("auto-allows a unique Tool from an effective configured Package in AUTO", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = await safetyHandler(
      autoPolicy(),
      requestApproval,
      [packageTool("subagent", "npm:pi-subagents@0.18.0")],
      ["pi-subagents"]
    );

    await expect(handler({
      toolCallId: "configured-package",
      toolName: "subagent",
      input: { action: "run" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("keeps the same configured Package Tool behind one-shot approval in ASK", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = await safetyHandler(
      { ...autoPolicy(), approvalMode: "guided", taskToolMode: "ask" },
      requestApproval,
      [packageTool("subagent", "npm:pi-subagents@0.18.0")],
      ["pi-subagents"]
    );

    await expect(handler({
      toolCallId: "configured-package-ask",
      toolName: "subagent",
      input: { action: "run" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "configured-operation",
      toolSource: "已配置 Package · pi-subagents"
    }), expect.any(Object));
  });

  it("retains approval for a unique but unconfigured top-level Extension", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = await safetyHandler(autoPolicy(), requestApproval, [extensionTool("custom_action")], []);

    await expect(handler({
      toolCallId: "unconfigured-extension",
      toolName: "custom_action",
      input: {}
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "unverified-tool",
      toolSource: "未配置的直接 Extension"
    }), expect.any(Object));
  });

  it("applies Memory add-versus-delete policy to MCP Direct Tools", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const tools = [
      packageTool("agent_memory_remember", "npm:pi-mcp-adapter@2.11.0"),
      packageTool("agent_memory_forget", "npm:pi-mcp-adapter@2.11.0")
    ];
    const handler = await safetyHandler(autoPolicy(), requestApproval, tools, ["pi-mcp-adapter"], {
      mcpServers: { agent_memory: { command: "redacted", directTools: true } },
      cache: { agent_memory: ["remember", "forget"] }
    });

    await expect(handler({
      toolCallId: "memory-add",
      toolName: "agent_memory_remember",
      input: { text: "not projected" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(handler({
      toolCallId: "memory-delete",
      toolName: "agent_memory_forget",
      input: { id: "memory-1" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "persistent-state-delete",
      target: "forget",
      toolSource: "MCP · agent_memory"
    }), expect.any(Object));
  });

  it("auto-allows task-scoped JS-Reverse instrumentation and configured Tavily reads", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const tools = [
      packageTool("js_reverse_remove_hook", "npm:pi-mcp-adapter@2.11.0"),
      packageTool("tavily_bridge_tavily_search", "npm:pi-mcp-adapter@2.11.0")
    ];
    const handler = await safetyHandler(autoPolicy(), requestApproval, tools, ["pi-mcp-adapter"], {
      mcpServers: {
        "js-reverse": { command: "redacted", directTools: true },
        "tavily-bridge": { url: "https://redacted.invalid", directTools: ["tavily_search"] }
      },
      cache: {
        "js-reverse": ["remove_hook"],
        "tavily-bridge": ["tavily_search"]
      }
    });

    await expect(handler({
      toolCallId: "js-reverse-remove-hook",
      toolName: "js_reverse_remove_hook",
      input: { hook_id: "hook-1" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(handler({
      toolCallId: "tavily-search",
      toolName: "tavily_bridge_tavily_search",
      input: { query: "fixture" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });
});

interface McpFixture {
  mcpServers: Record<string, Record<string, unknown>>;
  cache: Record<string, string[]>;
}

async function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  tools: ReturnType<ExtensionAPI["getAllTools"]>,
  packages: string[],
  mcp?: McpFixture
): Promise<SafetyHandler> {
  const root = await mkdtemp(join(tmpdir(), "pi67-configured-safety-"));
  temporaryDirectories.push(root);
  await Promise.all([
    writeFile(join(root, "mcp.json"), JSON.stringify({
      mcpServers: mcp?.mcpServers ?? {},
      settings: { toolPrefix: "short" }
    }), "utf8"),
    writeFile(join(root, "mcp-cache.json"), JSON.stringify({
      version: 1,
      servers: Object.fromEntries(Object.entries(mcp?.cache ?? {}).map(([server, names]) => [
        server,
        { tools: names.map((name) => ({ name, inputSchema: { type: "object" } })) }
      ]))
    }), "utf8")
  ]);
  const catalog = new ConfiguredCapabilityCatalog({
    agentDir: root,
    settingsManager: SettingsManager.inMemory({ packages })
  });
  await catalog.refresh();

  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools: () => tools,
    getActiveTools: () => tools.map((tool) => tool.name),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(() => policy, requestApproval, undefined, catalog);
  if (!("factory" in extension)) throw new Error("Expected the Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

function autoPolicy(): SafetyPolicyState {
  return { cwd: "/workspace", trust: "trusted", approvalMode: "balanced", taskToolMode: "auto" };
}

function packageTool(name: string, source: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: source, source, scope: "user", origin: "package" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}

function extensionTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: {
      path: `/extensions/${name}.ts`,
      source: "extensions",
      scope: "user",
      origin: "top-level"
    }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
