import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MAX_APPROVAL_CWD_BYTES, MAX_APPROVAL_TARGET_BYTES } from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

type SafetyHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: { hasUI: boolean; signal?: AbortSignal }
) => Promise<{ block?: boolean; reason?: string } | undefined>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("createDesktopSafetyExtension", () => {
  it("keeps the internal policy extension out of user-facing catalogs", () => {
    const extension = createDesktopSafetyExtension(
      () => trustedPolicy(),
      vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" })
    );
    expect(extension).toMatchObject({ name: "pi67-desktop-safety", hidden: true });
  });

  it("passes the exact tool call identity and structured command context to one-shot approval", async () => {
    const signal = new AbortController().signal;
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "allowed" });
    const handler = safetyHandler(trustedPolicy(), requestApproval);

    await expect(handler({
      toolCallId: "tool-call-exact-67",
      toolName: "bash",
      input: { command: "git status --short" }
    }, { hasUI: true, signal })).resolves.toBeUndefined();

    expect(requestApproval).toHaveBeenCalledOnce();
    expect(requestApproval).toHaveBeenCalledWith({
      toolCallId: "tool-call-exact-67",
      toolName: "bash",
      toolSource: "Pi 内置",
      category: "workspace-command",
      reason: "执行工作区内的非破坏性命令",
      targetKind: "command",
      target: "git status --short",
      targetTruncated: false,
      cwd: "/workspace",
      cwdTruncated: false,
      scope: "single-tool-call"
    }, { signal });
  });

  it("blocks when the user rejects the request", async () => {
    const handler = safetyHandler(
      trustedPolicy(),
      vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" })
    );

    await expect(handler({
      toolCallId: "tool-call-rejected",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "工具已注册，但用户未批准本次一次性授权：执行工作区内的非破坏性命令。这不表示工具不可用；不要自动重试。"
    });
  });

  it("distinguishes a system-cancelled approval from an explicit user denial", async () => {
    const handler = safetyHandler(
      trustedPolicy(),
      vi.fn<DesktopApprovalRequester>().mockResolvedValue({
        status: "cancelled",
        reason: "projection-resync"
      })
    );

    await expect(handler({
      toolCallId: "tool-call-cancelled",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "授权请求因 Desktop 状态变化而取消（projection-resync），工具未执行；这不是用户拒绝。"
    });
  });

  it("auto-allows bounded workspace commands in balanced mode", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = safetyHandler({
      ...trustedPolicy(),
      approvalMode: "balanced",
      taskToolMode: "auto"
    }, requestApproval);

    await expect(handler({
      toolCallId: "tool-call-workspace-command",
      toolName: "bash",
      input: { command: "git status --short" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("auto-allows only the exact internal Desktop attachment Tool and its bounded input", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = safetyHandler(
      trustedPolicy(),
      requestApproval,
      () => [desktopAttachmentTool()]
    );

    await expect(handler({
      toolCallId: "tool-call-attachment-read",
      toolName: "read_attachment",
      input: { setId: "set_a", operation: "read_text", attachmentId: "attachment_a" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("keeps malformed or ambiguous same-name attachment Tools behind approval", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    let tools = [desktopAttachmentTool()];
    const handler = safetyHandler(trustedPolicy(), requestApproval, () => tools);

    await expect(handler({
      toolCallId: "tool-call-malformed-attachment",
      toolName: "read_attachment",
      input: { setId: "../outside", operation: "read_text", attachmentId: "attachment_a" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    tools = [desktopAttachmentTool(), extensionTool("read_attachment")];
    await expect(handler({
      toolCallId: "tool-call-ambiguous-attachment",
      toolName: "read_attachment",
      input: { setId: "set_a", operation: "read_text", attachmentId: "attachment_a" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledTimes(1);
  });

  it("auto-allows canonical safety classification for verified Desktop web aliases", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = safetyHandler(
      trustedPolicy(),
      requestApproval,
      () => [
        sdkTool("WebSearch"),
        packageTool("web_search", "npm:pi-web-access@0.17.0"),
        sdkTool("web_fetch"),
        packageTool("fetch_content", "npm:pi-web-access@0.17.0")
      ],
      () => ["WebSearch", "web_search", "web_fetch", "fetch_content"]
    );

    await expect(handler({
      toolCallId: "tool-call-web-search-alias",
      toolName: "WebSearch",
      input: { query: "杭州天气", workflow: "none" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(handler({
      toolCallId: "tool-call-web-fetch-alias",
      toolName: "web_fetch",
      input: {
        url: "https://weather.example.invalid/hangzhou",
        format: "markdown",
        maxChars: 20_000
      }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("keeps malformed or local pi-web-access fetches behind approval", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = safetyHandler(
      trustedPolicy(),
      requestApproval,
      () => [packageTool("fetch_content", "npm:pi-web-access@0.17.0")]
    );

    await expect(handler({
      toolCallId: "tool-call-local-web-fetch",
      toolName: "fetch_content",
      input: { url: "file:///Users/test/private.mov" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "unverified-tool",
      target: "fetch_content"
    }), expect.any(Object));
  });

  it("does not grant pi-web-access network classification to same-name third-party tools", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = safetyHandler(
      trustedPolicy(),
      requestApproval,
      () => [packageTool("web_search", "npm:unrelated-extension@1.0.0")]
    );

    await expect(handler({
      toolCallId: "tool-call-unverified-web-search",
      toolName: "web_search",
      input: { query: "杭州天气" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("fails closed when the approval requester throws", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockRejectedValue(new Error("connection lost"));
    const handler = safetyHandler(trustedPolicy(), requestApproval);

    await expect(handler({
      toolCallId: "tool-call-error",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "π approval was unavailable and failed closed."
    });
  });

  it("fails closed when the operation aborts before or while approval resolves", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const earlyRequester = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "allowed" });
    const earlyHandler = safetyHandler(trustedPolicy(), earlyRequester);

    await expect(earlyHandler({
      toolCallId: "tool-call-already-aborted",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true, signal: alreadyAborted.signal })).resolves.toMatchObject({ block: true });
    expect(earlyRequester).not.toHaveBeenCalled();

    const racingAbort = new AbortController();
    const racingRequester = vi.fn<DesktopApprovalRequester>().mockImplementation(async () => {
      racingAbort.abort();
      return { status: "allowed" };
    });
    const racingHandler = safetyHandler(trustedPolicy(), racingRequester);
    await expect(racingHandler({
      toolCallId: "tool-call-abort-race",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true, signal: racingAbort.signal })).resolves.toMatchObject({ block: true });
  });

  it("does not request approval when no interactive UI is available", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = safetyHandler(trustedPolicy(), requestApproval);

    await expect(handler({
      toolCallId: "tool-call-headless",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: false })).resolves.toEqual({
      block: true,
      reason: "π approval UI is unavailable."
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("auto-allows only the current Pi builtin structured read contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-safety-builtin-"));
    temporaryDirectories.push(root);
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = safetyHandler(
      { ...trustedPolicy(), cwd: root },
      requestApproval,
      () => [builtinTool("read")]
    );

    await expect(handler({
      toolCallId: "tool-call-builtin-read",
      toolName: "read",
      input: { path: "README.md" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("requires approval for same-name overrides and malformed builtin input", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    let source = extensionTool("read");
    const handler = safetyHandler(trustedPolicy(), requestApproval, () => [source]);

    await expect(handler({
      toolCallId: "tool-call-overridden-read",
      toolName: "read",
      input: { path: "/workspace/README.md" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenLastCalledWith(expect.objectContaining({
      toolCallId: "tool-call-overridden-read",
      category: "unverified-tool",
      targetKind: "tool",
      target: "read"
    }), expect.any(Object));

    source = builtinTool("read");
    await expect(handler({
      toolCallId: "tool-call-malformed-read",
      toolName: "read",
      input: {}
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenLastCalledWith(expect.objectContaining({
      toolCallId: "tool-call-malformed-read",
      category: "unverified-tool",
      targetKind: "tool"
    }), expect.any(Object));
  });

  it("refuses commands and working directories that cannot be displayed in full", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const commandHandler = safetyHandler(trustedPolicy(), requestApproval);
    const cwdHandler = safetyHandler({
      ...trustedPolicy(),
      cwd: `/${"a".repeat(MAX_APPROVAL_CWD_BYTES + 1)}`
    }, requestApproval);

    await expect(commandHandler({
      toolCallId: "tool-call-long-command",
      toolName: "bash",
      input: { command: "中".repeat(MAX_APPROVAL_TARGET_BYTES) }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    await expect(cwdHandler({
      toolCallId: "tool-call-long-cwd",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).not.toHaveBeenCalled();
  });
});

function trustedPolicy(): SafetyPolicyState {
  return {
    cwd: "/workspace",
    trust: "trusted",
    approvalMode: "guided",
    taskToolMode: "ask"
  };
}

function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  getAllTools: () => ReturnType<ExtensionAPI["getAllTools"]> = () => [builtinTool("bash")],
  getActiveTools?: () => string[]
): SafetyHandler {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools,
    getActiveTools: getActiveTools ?? (() => getAllTools().map((tool) => tool.name)),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(
    () => policy,
    requestApproval
  );
  if (!("factory" in extension)) throw new Error("Expected the named Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

function sdkTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool(name),
    sourceInfo: {
      path: `<sdk:${name}>`,
      source: "sdk",
      scope: "temporary",
      origin: "top-level"
    }
  };
}

function builtinTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: {
      path: `<builtin:${name}>`,
      source: "builtin",
      scope: "temporary",
      origin: "top-level"
    }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}

function extensionTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool(name),
    sourceInfo: {
      path: `/extensions/${name}.ts`,
      source: "extension",
      scope: "user",
      origin: "top-level"
    }
  };
}

function packageTool(
  name: string,
  source: string
): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool(name),
    sourceInfo: {
      path: source,
      source,
      scope: "user",
      origin: "package"
    }
  };
}

function desktopAttachmentTool(): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    ...builtinTool("read_attachment"),
    sourceInfo: {
      path: "<inline:pi67-desktop-attachments>",
      source: "inline",
      scope: "temporary",
      origin: "top-level"
    }
  };
}
