import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createDesktopToolAliasBinding,
  createDesktopToolRoutingExtension
} from "./tool-routing-extension.js";

type BeforeAgentStartHandler = (event: {
  systemPrompt: string;
}) => { systemPrompt?: string } | undefined;

type MessageEndHandler = (event: {
  message: {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
    timestamp: number;
  };
}) => { message?: { content?: Array<{ type: "text"; text: string }>; isError?: boolean } } | undefined;

type ToolCallHandler = (event: {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}) => { block: true; reason: string } | undefined;

describe("createDesktopToolRoutingExtension", () => {
  it("adds compact guidance only for executable compatibility aliases", () => {
    const handlers = routingHandlers([
      "Bash",
      "bash",
      "Read",
      "read",
      "Edit",
      "edit",
      "Write",
      "write",
      "Glob",
      "find",
      "Grep",
      "grep",
      "WebSearch",
      "web_search",
      "WebFetch",
      "web_fetch",
      "fetch_content",
      "subagent"
    ]);
    const result = handlers.beforeAgentStart({ systemPrompt: "base prompt" });

    expect(result?.systemPrompt).toContain("base prompt");
    expect(result?.systemPrompt).toContain("`Bash`→`bash`");
    expect(result?.systemPrompt).toContain("`WebSearch`→`web_search`");
    expect(result?.systemPrompt).toContain("`web_fetch`→`fetch_content`");
    expect(result?.systemPrompt).toContain("Prefer native Pi tool names and schemas");
    expect(result?.systemPrompt).toContain('workflow: "none"');
    expect(result?.systemPrompt).toContain("do not switch providers");
    expect(result?.systemPrompt).toContain("selected model decides whether to call its declared native search route");
    expect(result?.systemPrompt).toContain("relative paths and bounded `bash` calls");
    expect(result?.systemPrompt).toContain("native `read`/`grep`/`find`/`ls` Tools");
    expect(result?.systemPrompt).not.toContain("Current registered tool names");

    expect(routingHandlers(["subagent"]).beforeAgentStart({ systemPrompt: "base" })).toBeUndefined();
    expect(routingHandlers(["read"]).beforeAgentStart({ systemPrompt: "base" })).toBeUndefined();
    expect(routingHandlers([]).beforeAgentStart({ systemPrompt: "base" })).toBeUndefined();
  });

  it("adds bounded AUTO guidance for the native Bash Tool without requiring aliases", () => {
    const result = routingHandlers(["bash", "read", "grep", "find"])
      .beforeAgentStart({ systemPrompt: "base" });
    expect(result?.systemPrompt).toContain("relative paths and bounded `bash` calls");
    expect(result?.systemPrompt).toContain("Split variables");
    expect(result?.systemPrompt).toContain("without broadening authorization");
  });

  it("explains pi-fff override and explicit naming from the live Package source", () => {
    const override = routingHandlers(["read", "grep", "find"], undefined, ["grep", "find"])
      .beforeAgentStart({ systemPrompt: "base" });
    expect(override?.systemPrompt).toContain("override naming mode");
    expect(override?.systemPrompt).toContain("live `find` and `grep` tools are FFF-backed");
    expect(override?.systemPrompt).toContain("never look them up or invoke them through `mcp`");
    expect(override?.systemPrompt).toContain("do not describe them as native fallbacks");

    const explicit = routingHandlers(["read", "ffgrep", "fffind"], undefined, ["ffgrep", "fffind"])
      .beforeAgentStart({ systemPrompt: "base" });
    expect(explicit?.systemPrompt).toContain("explicit live names `fffind` and `ffgrep`");
    expect(explicit?.systemPrompt).toContain("never through `mcp`");

    expect(routingHandlers(["read", "grep", "find"])
      .beforeAgentStart({ systemPrompt: "base" })).toBeUndefined();
  });

  it("turns an unknown Agent result into a recoverable exact-tool instruction", () => {
    const handlers = routingHandlers(["web_search", "subagent"]);
    const result = handlers.messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "agent-call-1",
        toolName: "Agent",
        content: [{ type: "text", text: "Tool Agent not found" }],
        isError: true,
        timestamp: 1
      }
    });
    const text = result?.message?.content?.[0]?.text;

    expect(text).toContain('没有注册 "Agent"');
    expect(text).toContain('精确工具名是 "subagent"');
    expect(text).not.toContain('"web_search"');
    expect(text).not.toContain("当前真实注册的工具包括");
  });

  it("recovers case-only and legacy web tool names from the active tool inventory", () => {
    const handlers = routingHandlers([
      "bash",
      "read",
      "edit",
      "write",
      "find",
      "grep",
      "web_search",
      "fetch_content"
    ]);
    const bash = handlers.messageEnd(missingToolMessage("Bash"))?.message?.content?.[0]?.text;
    const read = handlers.messageEnd(missingToolMessage("Read"))?.message?.content?.[0]?.text;
    const edit = handlers.messageEnd(missingToolMessage("Edit"))?.message?.content?.[0]?.text;
    const write = handlers.messageEnd(missingToolMessage("Write"))?.message?.content?.[0]?.text;
    const glob = handlers.messageEnd(missingToolMessage("Glob"))?.message?.content?.[0]?.text;
    const grep = handlers.messageEnd(missingToolMessage("Grep"))?.message?.content?.[0]?.text;
    const search = handlers.messageEnd(missingToolMessage("WebSearch"))?.message?.content?.[0]?.text;
    const fetch = handlers.messageEnd(missingToolMessage("WebFetch"))?.message?.content?.[0]?.text;
    const lowerFetch = handlers.messageEnd(missingToolMessage("web_fetch"))?.message?.content?.[0]?.text;

    expect(bash).toContain('精确工具名是 "bash"');
    expect(read).toContain('精确工具名是 "read"');
    expect(edit).toContain('精确工具名是 "edit"');
    expect(write).toContain('精确工具名是 "write"');
    expect(glob).toContain('精确工具名是 "find"');
    expect(grep).toContain('精确工具名是 "grep"');
    expect(search).toContain('精确工具名是 "web_search"');
    expect(fetch).toContain('精确工具名是 "fetch_content"');
    expect(lowerFetch).toContain('精确工具名是 "fetch_content"');
  });

  it("does not claim web lookup is available when only subagent is registered", () => {
    const handlers = routingHandlers(["subagent"]);
    const result = handlers.messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "agent-call-2",
        toolName: "Agent",
        content: [{ type: "text", text: "Tool Agent not found" }],
        isError: true,
        timestamp: 1
      }
    });
    const text = result?.message?.content?.[0]?.text;

    expect(text).toContain('"subagent"');
    expect(text).not.toContain('"web_search"');
  });

  it("does not rewrite registered-tool failures or unrelated error text", () => {
    const handlers = routingHandlers(["Agent", "web_search"]);
    expect(handlers.messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "agent-call-registered",
        toolName: "Agent",
        content: [{ type: "text", text: "extension failure" }],
        isError: true,
        timestamp: 1
      }
    })).toBeUndefined();

    expect(routingHandlers(["bash"]).messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "bash-call-failed",
        toolName: "MissingTool",
        content: [{ type: "text", text: "extension failure" }],
        isError: true,
        timestamp: 1
      }
    })).toBeUndefined();
  });

  it("marks native web search failures and prevents provider switching", () => {
    const handlers = routingHandlers(["WebSearch", "web_search", "WebFetch", "fetch_content", "read"]);
    handlers.toolCall({
      toolCallId: "search-auto",
      toolName: "web_search",
      input: { query: "杭州天气", workflow: "none" }
    });
    const result = handlers.messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "search-auto",
        toolName: "web_search",
        content: [{ type: "text", text: "Error: NATIVE_WEB_SEARCH_UNAVAILABLE: rate limit" }],
        isError: false,
        timestamp: 1
      }
    });

    expect(result?.message?.isError).toBe(true);
    expect(result?.message?.content?.[0]?.text).toContain("当前模型的原生搜索调用失败");
    expect(result?.message?.content?.[0]?.text).toContain("不要切换 Provider");

    expect(handlers.toolCall({
      toolCallId: "search-brave",
      toolName: "web_search",
      input: { query: "杭州天气", provider: "brave" }
    })).toMatchObject({
      block: true,
      reason: expect.stringContaining("不要切换 Provider")
    });
    expect(handlers.toolCall({
      toolCallId: "read-search-config",
      toolName: "read",
      input: { path: "/Users/test/.pi/web-search.json" }
    })).toMatchObject({
      block: true,
      reason: expect.stringContaining("不要读取可能包含凭据")
    });
    expect(handlers.toolCall({
      toolCallId: "fetch-known-url",
      toolName: "fetch_content",
      input: { url: "https://weather.example.test/hangzhou" }
    })).toBeUndefined();
    expect(handlers.toolCall({
      toolCallId: "fetch-known-url-again",
      toolName: "fetch_content",
      input: { url: "https://weather.example.test/hangzhou?format=full" }
    })).toMatchObject({
      block: true,
      reason: expect.stringContaining("不要继续变换 URL")
    });
  });

  it("does not rewrite successful web results or same-name third-party tools", () => {
    const verified = routingHandlers(["WebSearch", "web_search"]);
    verified.toolCall({ toolCallId: "search-ok", toolName: "web_search", input: { query: "weather" } });
    expect(verified.messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "search-ok",
        toolName: "web_search",
        content: [{ type: "text", text: "Weather result" }],
        isError: false,
        timestamp: 1
      }
    })).toBeUndefined();

    const thirdParty = routingHandlers(["web_search"], "npm:other-search@1.0.0");
    thirdParty.toolCall({ toolCallId: "search-other", toolName: "web_search", input: { query: "weather" } });
    expect(thirdParty.messageEnd({
      message: {
        role: "toolResult",
        toolCallId: "search-other",
        toolName: "web_search",
        content: [{ type: "text", text: "Error: provider search failed" }],
        isError: false,
        timestamp: 1
      }
    })).toBeUndefined();
  });

  it("maps common legacy arguments deterministically before Pi validation", () => {
    const binding = createDesktopToolAliasBinding();
    const search = binding.tools.find((tool) => tool.name === "WebSearch");
    const fetch = binding.tools.find((tool) => tool.name === "web_fetch");
    const edit = binding.tools.find((tool) => tool.name === "Edit");
    const bash = binding.tools.find((tool) => tool.name === "Bash");
    if (!search?.prepareArguments || !fetch?.prepareArguments || !edit?.prepareArguments || !bash?.prepareArguments) {
      throw new Error("Expected Desktop compatibility argument adapters.");
    }

    expect(search.prepareArguments({ query: "杭州天气" })).toEqual({
      query: "杭州天气",
      workflow: "none"
    });
    expect(fetch.prepareArguments({
      url: "https://weather.example.invalid/hangzhou",
      format: "markdown",
      maxChars: 20_000
    })).toEqual({
      url: "https://weather.example.invalid/hangzhou"
    });
    expect(edit.prepareArguments({
      file_path: "/workspace/a.ts",
      old_string: "before",
      new_string: "after"
    })).toEqual({
      path: "/workspace/a.ts",
      edits: [{ oldText: "before", newText: "after" }]
    });
    expect(() => edit.prepareArguments?.({
      file_path: "/workspace/a.ts",
      old_string: "before",
      new_string: "after",
      replace_all: true
    })).toThrow("does not guess replace_all semantics");
    expect(bash.prepareArguments({ command: "pwd", timeout: 120_000 })).toEqual({
      command: "pwd",
      timeout: 120
    });
  });
});

function missingToolMessage(toolName: string): Parameters<MessageEndHandler>[0] {
  return {
    message: {
      role: "toolResult",
      toolCallId: `${toolName}-call`,
      toolName,
      content: [{ type: "text", text: `Tool ${toolName} not found` }],
      isError: true,
      timestamp: 1
    }
  };
}

function routingHandlers(
  activeTools: string[],
  webSearchSource = "sdk",
  piFffTools: readonly string[] = []
): {
  beforeAgentStart: BeforeAgentStartHandler;
  messageEnd: MessageEndHandler;
  toolCall: ToolCallHandler;
} {
  let beforeAgentStart: BeforeAgentStartHandler | undefined;
  let messageEnd: MessageEndHandler | undefined;
  let toolCall: ToolCallHandler | undefined;
  const api = {
    getActiveTools: () => activeTools,
    getAllTools: () => activeTools.map((name) => ({
      name,
      sourceInfo: piFffTools.includes(name)
        ? {
            source: "npm:@ff-labs/pi-fff@0.10.1",
            path: "/package/pi-fff/src/index.ts",
            scope: "user",
            origin: "package"
          }
        : name === "web_search" || name === "fetch_content"
          ? webSearchSource === "sdk"
            ? { source: "sdk", path: `<sdk:${name}>`, scope: "temporary", origin: "top-level" }
            : { source: webSearchSource, path: "/package/index.ts", scope: "user", origin: "package" }
        : name === "WebSearch"
          ? { source: "sdk", path: "<sdk:WebSearch>", scope: "temporary", origin: "top-level" }
        : name === "WebFetch"
          ? { source: "sdk", path: "<sdk:WebFetch>", scope: "temporary", origin: "top-level" }
          : name === "web_fetch"
            ? { source: "sdk", path: "<sdk:web_fetch>", scope: "temporary", origin: "top-level" }
          : { source: "builtin", path: `<builtin:${name}>`, scope: "temporary", origin: "top-level" }
    })),
    on(event: string, candidate: unknown) {
      if (event === "before_agent_start") beforeAgentStart = candidate as BeforeAgentStartHandler;
      if (event === "message_end") messageEnd = candidate as MessageEndHandler;
      if (event === "tool_call") toolCall = candidate as ToolCallHandler;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopToolRoutingExtension();
  if (!("factory" in extension)) throw new Error("Expected the named Desktop tool-routing extension factory.");
  void extension.factory(api);
  if (!beforeAgentStart || !messageEnd || !toolCall) throw new Error("Desktop tool-routing handlers were not registered.");
  return { beforeAgentStart, messageEnd, toolCall };
}
