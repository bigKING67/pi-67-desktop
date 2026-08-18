import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";
import { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";

type SafetyHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { hasUI: boolean }
) => Promise<{ block?: boolean; reason?: string } | undefined>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("createDesktopSafetyExtension pi-mcp-adapter classification", () => {
  it("auto-allows verified local MCP metadata inspection without a duplicate approval", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const tool = await unversionedMcpTool("2.11.0");
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => [tool]);

    for (const [index, input] of [
      {},
      { server: "tmwd_browser" },
      { search: "fffind", includeSchemas: false },
      { search: "browser snapshot", regex: true, server: "tmwd_browser" },
      { describe: "tmwd_browser_browser_snapshot" },
      { action: "ui-messages" }
    ].entries()) {
      await expect(handler({
        toolCallId: `metadata-${index}`,
        toolName: "mcp",
        input
      }, { hasUI: true })).resolves.toBeUndefined();
    }

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("keeps the supported 2.10 proxy metadata contract compatible", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.10.0")
    ]);

    await expect(handler({
      toolCallId: "metadata-2-10",
      toolName: "mcp",
      input: { search: "browser" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("auto-allows configured MCP connections and authentication in AUTO", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0")
    ]);

    for (const [index, input] of [
      { connect: "tmwd_browser" },
      { tool: "tmwd_browser_browser_snapshot", args: "{}", server: "tmwd_browser" },
      { tool: "browser_scan", args: { query: "main" }, server: "tmwd_browser" },
      { tool: "browser_extract", args: { selector: "main" }, server: "tmwd_browser" },
      { tool: "browser_tab_ops", args: { action: "navigate", url: "https://example.invalid" }, server: "tmwd_browser" },
      { tool: "browser_screenshot_ops", args: { action: "capture" }, server: "tmwd_browser" },
      { tool: "browser_transport_health", args: {}, server: "tmwd_browser" },
      { tool: "browser_file_ops", args: { action: "inspect_inputs" }, server: "tmwd_browser" },
      { action: "auth-start", server: "linear" },
      { action: "auth-complete", server: "linear", args: "{\"code\":\"test\"}" }
    ].entries()) {
      await expect(handler({
        toolCallId: `configured-${index}`,
        toolName: "mcp",
        input
      }, { hasUI: true })).resolves.toBeUndefined();
    }

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("auto-allows installed browser67 JavaScript, native input, auth, clipboard, and file side effects", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0")
    ]);

    for (const [index, input] of [
      { tool: "browser_execute_js", args: { expression: "document.title" }, server: "tmwd_browser" },
      { tool: "browser_native_input", args: { action: "click" }, server: "tmwd_browser" },
      { tool: "browser_auth_ops", args: { action: "login" }, server: "tmwd_browser" },
      { tool: "browser_clipboard_ops", args: { action: "write" }, server: "tmwd_browser" },
      { tool: "browser_file_ops", args: { action: "set_files" }, server: "tmwd_browser" }
    ].entries()) {
      await expect(handler({
        toolCallId: `browser-sensitive-${index}`,
        toolName: "mcp",
        input
      }, { hasUI: true })).resolves.toBeUndefined();
    }

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("keeps installed browser67 side effects behind one-shot approval in ASK", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = await safetyHandler(askPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0")
    ]);

    await expect(handler({
      toolCallId: "browser-sensitive-ask",
      toolName: "mcp",
      input: {
        tool: "browser_execute_js",
        args: { expression: "document.title" },
        server: "tmwd_browser"
      }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "external-submit",
      toolSource: "MCP · tmwd_browser"
    }), expect.any(Object));
  });

  it("corrects pi-fff proxy misroutes without opening an approval", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0"),
      packageTool("find", "npm:@ff-labs/pi-fff@0.10.1"),
      packageTool("grep", "npm:@ff-labs/pi-fff@0.10.1")
    ]);

    for (const [index, input] of [
      { tool: "fffind", args: '{"pattern":"package.json"}' },
      { tool: "ffgrep", args: '{"pattern":"preview:mac:unsigned","path":"package.json"}' }
    ].entries()) {
      await expect(handler({
        toolCallId: `pi-fff-misroute-${index}`,
        toolName: "mcp",
        input
      }, { hasUI: true })).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining(index === 0 ? "`find`" : "`grep`")
      });
    }

    const namedHandler = await safetyHandler(autoPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0"),
      packageTool("fffind", "npm:@ff-labs/pi-fff@0.10.1")
    ]);
    await expect(namedHandler({
      toolCallId: "pi-fff-named-misroute",
      toolName: "mcp",
      input: { tool: "fffind", args: '{"pattern":"package.json"}' }
    }, { hasUI: true })).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining("`fffind`")
    });

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("auto-allows an explicitly targeted configured MCP tool despite a Pi name collision", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0"),
      packageTool("find", "npm:@ff-labs/pi-fff@0.10.1")
    ]);

    await expect(handler({
      toolCallId: "explicit-server-fffind",
      toolName: "mcp",
      input: { tool: "fffind", args: "{}", server: "external-server" }
    }, { hasUI: true })).resolves.toBeUndefined();

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("fails closed for malformed, duplicate, and unsupported MCP proxy identities", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    let tools = [packageTool("mcp", "npm:pi-mcp-adapter@2.11.0")];
    const handler = await safetyHandler(autoPolicy(), requestApproval, () => tools);

    await expect(handler({
      toolCallId: "metadata-malformed",
      toolName: "mcp",
      input: { search: "x".repeat(513) }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    tools = [packageTool("mcp", "npm:pi-mcp-adapter@2.9.0")];
    await expect(handler({
      toolCallId: "metadata-unsupported",
      toolName: "mcp",
      input: { search: "fffind" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    tools = [
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0"),
      packageTool("mcp", "npm:pi-mcp-adapter@2.11.0")
    ];
    await expect(handler({
      toolCallId: "metadata-duplicate",
      toolName: "mcp",
      input: { search: "fffind" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    expect(requestApproval).not.toHaveBeenCalled();
  });
});

function autoPolicy(): SafetyPolicyState {
  return { cwd: "/workspace", trust: "trusted", approvalMode: "balanced", taskToolMode: "auto" };
}

function askPolicy(): SafetyPolicyState {
  return { cwd: "/workspace", trust: "trusted", approvalMode: "guided", taskToolMode: "ask" };
}

async function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  getTools: () => ReturnType<ExtensionAPI["getAllTools"]>
): Promise<SafetyHandler> {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools: getTools,
    getActiveTools: () => getTools().map((tool) => tool.name),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const catalog = await configuredCatalog();
  const extension = createDesktopSafetyExtension(() => policy, requestApproval, undefined, catalog);
  if (!("factory" in extension)) throw new Error("Expected the Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

async function configuredCatalog(): Promise<ConfiguredCapabilityCatalog> {
  const root = await mkdtemp(join(tmpdir(), "pi67-mcp-catalog-"));
  temporaryDirectories.push(root);
  await Promise.all([
    writeFile(join(root, "mcp.json"), JSON.stringify({
      mcpServers: {
        tmwd_browser: { command: "redacted" },
        linear: { url: "https://redacted.invalid" },
        "external-server": { command: "redacted" }
      }
    }), "utf8"),
    writeFile(join(root, "mcp-cache.json"), JSON.stringify({
      version: 1,
      servers: {
        tmwd_browser: {
          tools: [
            "tmwd_browser_browser_snapshot",
            "browser_scan",
            "browser_extract",
            "browser_tab_ops",
            "browser_screenshot_ops",
            "browser_transport_health",
            "browser_execute_js",
            "browser_native_input",
            "browser_auth_ops",
            "browser_clipboard_ops",
            "browser_file_ops"
          ].map((name) => ({ name, inputSchema: { type: "object" } }))
        },
        linear: { tools: [] },
        "external-server": { tools: [{ name: "fffind", inputSchema: { type: "object" } }] }
      }
    }), "utf8")
  ]);
  const catalog = new ConfiguredCapabilityCatalog({
    agentDir: root,
    settingsManager: SettingsManager.inMemory()
  });
  await catalog.refresh();
  return catalog;
}

async function unversionedMcpTool(
  version: "2.10.0" | "2.11.0"
): Promise<ReturnType<ExtensionAPI["getAllTools"]>[number]> {
  const packageDirectory = await mkdtemp(join(tmpdir(), "pi67-mcp-adapter-"));
  temporaryDirectories.push(packageDirectory);
  await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
    name: "pi-mcp-adapter",
    version
  }), "utf8");
  return {
    name: "mcp",
    description: "MCP gateway",
    parameters: { type: "object" },
    sourceInfo: {
      path: join(packageDirectory, "index.ts"),
      baseDir: packageDirectory,
      source: "npm:pi-mcp-adapter",
      scope: "user",
      origin: "package"
    }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}

function packageTool(
  name: string,
  source: string
): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: source, source, scope: "user", origin: "package" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
