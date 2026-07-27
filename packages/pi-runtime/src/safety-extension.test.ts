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
      vi.fn<DesktopApprovalRequester>().mockResolvedValue(false)
    );
    expect(extension).toMatchObject({ name: "pi67-desktop-safety", hidden: true });
  });

  it("passes the exact tool call identity and structured command context to one-shot approval", async () => {
    const signal = new AbortController().signal;
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue(true);
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
      category: "ambiguous-command",
      reason: "执行无法安全分类的命令",
      targetKind: "command",
      target: "git status --short",
      targetTruncated: false,
      cwd: "/workspace",
      cwdTruncated: false,
      scope: "single-tool-call"
    }, { signal });
  });

  it("blocks when the user rejects the request", async () => {
    const handler = safetyHandler(trustedPolicy(), vi.fn<DesktopApprovalRequester>().mockResolvedValue(false));

    await expect(handler({
      toolCallId: "tool-call-rejected",
      toolName: "bash",
      input: { command: "pwd" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "Blocked by user: ambiguous-command"
    });
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
      reason: "Pi-67 Desktop approval was unavailable and failed closed."
    });
  });

  it("fails closed when the operation aborts before or while approval resolves", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const earlyRequester = vi.fn<DesktopApprovalRequester>().mockResolvedValue(true);
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
      return true;
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
      reason: "Pi-67 Desktop approval UI is unavailable."
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("auto-allows only the current Pi builtin structured read contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-safety-builtin-"));
    temporaryDirectories.push(root);
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue(false);
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
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue(false);
    let source = extensionTool("read");
    const handler = safetyHandler(trustedPolicy(), requestApproval, () => [source]);

    await expect(handler({
      toolCallId: "tool-call-overridden-read",
      toolName: "read",
      input: { path: "/workspace/README.md" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenLastCalledWith(expect.objectContaining({
      toolCallId: "tool-call-overridden-read",
      category: "ambiguous-command",
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
      category: "ambiguous-command",
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
  return { cwd: "/workspace", trust: "trusted", approvalMode: "guided" };
}

function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  getAllTools: () => ReturnType<ExtensionAPI["getAllTools"]> = () => []
): SafetyHandler {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools,
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(() => policy, requestApproval);
  if (!("factory" in extension)) throw new Error("Expected the named Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
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
