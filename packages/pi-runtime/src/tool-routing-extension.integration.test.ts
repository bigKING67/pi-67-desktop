import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  createAgentSessionFromServices
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { createDesktopSessionServices } from "./session-services.js";
import { createDesktopToolAliasBinding } from "./tool-routing-extension.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop tool routing Extension integration", () => {
  it("forwards a verified alias and disables aliases whose canonical source is unverified", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-tool-routing-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await writeFile(join(extensionsDirectory, "web-search.ts"), `
      import { Type } from "typebox";
      export default function register(pi) {
        pi.registerTool({
          name: "web_search",
          label: "Web search",
          description: "Search the web",
          parameters: Type.Object({ query: Type.String() }),
          async execute() {
            return { content: [{ type: "text", text: "fixture" }] };
          }
        });
      }
    `, "utf8");

    const requestApproval = vi.fn(async () => ({ status: "allowed" as const }));
    const services = await createDesktopSessionServices({
      cwd,
      agentDir,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval
    });
    const aliases = createDesktopToolAliasBinding();
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd),
      customTools: aliases.tools
    });
    aliases.bind(session);
    const bridge = new DesktopExtensionUiBridge(() => undefined);

    try {
      await session.bindExtensions({ uiContext: bridge.context, mode: "rpc" });
      expect(session.extensionRunner.getActiveTools()).toContain("web_search");
      expect(session.getActiveToolNames()).toContain("Bash");
      expect(session.getActiveToolNames()).not.toContain("WebSearch");

      const beforeStart = await session.extensionRunner.emitBeforeAgentStart(
        "杭州天气如何",
        undefined,
        "base prompt",
        { cwd }
      );
      expect(beforeStart?.systemPrompt).toContain("`Bash`→`bash`");
      expect(beforeStart?.systemPrompt).not.toContain("`WebSearch`→`web_search`");

      const bashAlias = session.getToolDefinition("Bash");
      if (!bashAlias?.prepareArguments) throw new Error("Expected the verified Bash alias.");
      const bashInput = bashAlias.prepareArguments({ command: "printf pi67-alias" });
      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "bash-alias-call",
        toolName: "Bash",
        input: bashInput as { command: string; timeout?: number }
      })).resolves.toBeUndefined();
      expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
        toolCallId: "bash-alias-call",
        toolName: "bash",
        target: "printf pi67-alias"
      }), expect.any(Object));
      const bashResult = await bashAlias.execute(
        "bash-alias-call",
        bashInput,
        undefined,
        undefined,
        {} as never
      );
      expect(bashResult.content).toEqual([expect.objectContaining({
        type: "text",
        text: expect.stringContaining("pi67-alias")
      })]);

      const replacement = await session.extensionRunner.emitMessageEnd({
        type: "message_end",
        message: {
          role: "toolResult",
          toolCallId: "agent-call-1",
          toolName: "Agent",
          content: [{ type: "text", text: "Tool Agent not found" }],
          isError: true,
          timestamp: 1
        }
      });
      expect(replacement).toMatchObject({
        role: "toolResult",
        toolName: "Agent",
        isError: true
      });
      if (!replacement || replacement.role !== "toolResult") {
        throw new Error("Expected the Desktop routing Extension to replace the Tool Result.");
      }
      expect(replacement.content).toEqual([expect.objectContaining({
        type: "text",
        text: expect.stringContaining('没有注册 "Agent"')
      })]);
    } finally {
      bridge.dispose();
      session.dispose();
    }
  }, 15_000);

  it("forwards verified pi-web-access aliases through safety and the canonical package tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-web-routing-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const packageDirectory = join(agentDir, "npm", "node_modules", "pi-web-access");
    await Promise.all([
      mkdir(cwd),
      mkdir(packageDirectory, { recursive: true })
    ]);
    await writeFile(join(packageDirectory, "package.json"), `${JSON.stringify({
      name: "pi-web-access",
      version: "0.17.0",
      type: "module",
      pi: { extensions: ["index.ts"] }
    }, null, 2)}\n`, "utf8");
    await writeFile(join(packageDirectory, "index.ts"), `
      import { Type } from "typebox";
      export default function register(pi) {
        pi.registerTool({
          name: "web_search",
          label: "Web search",
          description: "Deterministic web search fixture",
          parameters: Type.Object({
            query: Type.Optional(Type.String()),
            queries: Type.Optional(Type.Array(Type.String())),
            workflow: Type.Optional(Type.String())
          }),
          async execute(_toolCallId, input) {
            return { content: [{ type: "text", text: "search:" + JSON.stringify(input) }] };
          }
        });
        pi.registerTool({
          name: "fetch_content",
          label: "Fetch content",
          description: "Deterministic fetch fixture",
          parameters: Type.Object({
            url: Type.Optional(Type.String()),
            urls: Type.Optional(Type.Array(Type.String())),
            prompt: Type.Optional(Type.String())
          }),
          async execute(_toolCallId, input) {
            return { content: [{ type: "text", text: "fetch:" + JSON.stringify(input) }] };
          }
        });
      }
    `, "utf8");
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
      packages: ["npm:pi-web-access@0.17.0"]
    }, null, 2)}\n`, "utf8");

    const requestApproval = vi.fn(async () => ({ status: "allowed" as const }));
    const services = await createDesktopSessionServices({
      cwd,
      agentDir,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval
    });
    const aliases = createDesktopToolAliasBinding();
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd),
      customTools: aliases.tools
    });
    aliases.bind(session);
    const bridge = new DesktopExtensionUiBridge(() => undefined);

    try {
      await session.bindExtensions({ uiContext: bridge.context, mode: "rpc" });
      expect(session.getActiveToolNames()).toEqual(expect.arrayContaining([
        "web_search",
        "fetch_content",
        "WebSearch",
        "WebFetch",
        "web_fetch"
      ]));
      expect(session.getAllTools().find((tool) => tool.name === "web_search")?.sourceInfo).toMatchObject({
        source: "npm:pi-web-access@0.17.0",
        origin: "package"
      });

      const webSearch = session.getToolDefinition("WebSearch");
      if (!webSearch?.prepareArguments) throw new Error("Expected the verified WebSearch alias.");
      const searchInput = webSearch.prepareArguments({ query: "Hangzhou weather" }) as Record<string, unknown>;
      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "web-search-alias-call",
        toolName: "WebSearch",
        input: searchInput
      })).resolves.toBeUndefined();
      expect(requestApproval).not.toHaveBeenCalled();
      const searchResult = await webSearch.execute(
        "web-search-alias-call",
        searchInput,
        undefined,
        undefined,
        {} as never
      );
      expect(searchResult.content).toEqual([expect.objectContaining({
        type: "text",
        text: 'search:{"query":"Hangzhou weather","workflow":"none"}'
      })]);

      const webFetch = session.getToolDefinition("web_fetch");
      if (!webFetch?.prepareArguments) throw new Error("Expected the verified web_fetch alias.");
      const fetchInput = webFetch.prepareArguments({
        url: "https://weather.example.invalid/hangzhou",
        format: "markdown",
        maxChars: 20_000
      }) as Record<string, unknown>;
      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "web-fetch-alias-call",
        toolName: "web_fetch",
        input: fetchInput
      })).resolves.toBeUndefined();
      expect(requestApproval).not.toHaveBeenCalled();
      const fetchResult = await webFetch.execute(
        "web-fetch-alias-call",
        fetchInput,
        undefined,
        undefined,
        {} as never
      );
      expect(fetchResult.content).toEqual([expect.objectContaining({
        type: "text",
        text: 'fetch:{"url":"https://weather.example.invalid/hangzhou"}'
      })]);

      requestApproval.mockClear();
      await session.extensionRunner.emitBeforeAgentStart(
        "杭州天气如何",
        undefined,
        "base prompt",
        { cwd }
      );
      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "web-search-auto-failed",
        toolName: "web_search",
        input: { query: "杭州天气", workflow: "none" }
      })).resolves.toBeUndefined();
      expect(requestApproval).not.toHaveBeenCalled();

      const failedSearch = await session.extensionRunner.emitMessageEnd({
        type: "message_end",
        message: {
          role: "toolResult",
          toolCallId: "web-search-auto-failed",
          toolName: "web_search",
          content: [{ type: "text", text: "Error: Auto provider search failed: Exa rate limit" }],
          isError: false,
          timestamp: 2
        }
      });
      expect(failedSearch).toMatchObject({
        role: "toolResult",
        isError: true,
        content: [expect.objectContaining({
          type: "text",
          text: expect.stringContaining("不要再逐个试探未配置的 Provider")
        })]
      });

      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "web-search-brave-probe",
        toolName: "web_search",
        input: { query: "杭州天气", provider: "brave" }
      })).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining("不要逐个试探未配置 Provider")
      });
      expect(requestApproval).not.toHaveBeenCalled();

      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "read-search-credentials",
        toolName: "read",
        input: { path: "/Users/test/.pi/web-search.json" }
      })).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining("不要读取可能包含凭据")
      });
      expect(requestApproval).not.toHaveBeenCalled();

      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "web-fetch-recovery",
        toolName: "web_fetch",
        input: { url: "https://weather.example.invalid/hangzhou", format: "markdown" }
      })).resolves.toBeUndefined();
      expect(requestApproval).not.toHaveBeenCalled();

      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "web-fetch-recovery-again",
        toolName: "web_fetch",
        input: { url: "https://weather.example.invalid/hangzhou?format=full", format: "markdown" }
      })).resolves.toMatchObject({
        block: true,
        reason: expect.stringContaining("不要继续变换 URL")
      });
      expect(requestApproval).not.toHaveBeenCalled();
    } finally {
      bridge.dispose();
      session.dispose();
    }
  }, 15_000);
});
