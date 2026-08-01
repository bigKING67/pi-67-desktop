import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("createDesktopSafetyExtension pi-fff classification", () => {
  it("auto-allows verified grep/find names and workspace-local glob roots", async () => {
    const workspace = await createWorkspace();
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const tools = ["grep", "find", "ffgrep", "fffind"].map((name) => piFffTool(name));
    const handler = safetyHandler(autoPolicy(workspace), requestApproval, () => tools);

    for (const call of [
      {
        toolCallId: "grep-workspace",
        toolName: "grep",
        input: { pattern: "ToolModeSelector", path: "src/**/*.ts", exclude: ["*.test.ts"], context: 2, limit: 40 }
      },
      {
        toolCallId: "find-workspace",
        toolName: "find",
        input: { pattern: "composer", path: ".", exclude: "node_modules/", limit: 20 }
      },
      {
        toolCallId: "ffgrep-workspace",
        toolName: "ffgrep",
        input: { pattern: "taskToolMode" }
      },
      {
        toolCallId: "fffind-workspace",
        toolName: "fffind",
        input: { pattern: "safety", path: "packages/" }
      }
    ]) {
      await expect(handler(call, { hasUI: true })).resolves.toBeUndefined();
    }

    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("requires approval for relative, absolute, home, and symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-fff-external-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await Promise.all([mkdir(workspace), mkdir(outside)]);
    await symlink(outside, join(workspace, "escape-link"));
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const tools = [piFffTool("grep"), piFffTool("find")];
    const handler = safetyHandler(autoPolicy(workspace), requestApproval, () => tools);

    for (const [index, path] of [
      "../outside",
      outside,
      "~",
      "escape-link/**"
    ].entries()) {
      await expect(handler({
        toolCallId: `external-${index}`,
        toolName: index % 2 === 0 ? "grep" : "find",
        input: { pattern: "needle", path }
      }, { hasUI: true })).resolves.toMatchObject({ block: true });
    }

    expect(requestApproval).toHaveBeenCalledTimes(4);
    expect(requestApproval.mock.calls.map(([request]) => request.category)).toEqual([
      "external-path",
      "external-path",
      "external-path",
      "external-path"
    ]);
    const canonicalOutside = await realpath(outside);
    expect(requestApproval.mock.calls[0]?.[0].target).toBe(canonicalOutside);
    expect(requestApproval.mock.calls[1]?.[0].target).toBe(canonicalOutside);
    expect(requestApproval.mock.calls[2]?.[0].target).toBe(await realpath(homedir()));
    expect(requestApproval.mock.calls[3]?.[0].target).toBe(resolve(canonicalOutside, "**"));
  });

  it("fails closed for malformed inputs and opaque pagination cursors", async () => {
    const workspace = await createWorkspace();
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const tools = [piFffTool("grep"), piFffTool("find")];
    const handler = safetyHandler(autoPolicy(workspace), requestApproval, () => tools);

    for (const call of [
      { toolCallId: "empty-pattern", toolName: "grep", input: { pattern: "" } },
      { toolCallId: "bad-context", toolName: "grep", input: { pattern: "x", context: -1 } },
      { toolCallId: "bad-limit", toolName: "find", input: { pattern: "x", limit: 0 } }
    ]) {
      await expect(handler(call, { hasUI: true })).resolves.toMatchObject({ block: true });
    }

    for (const call of [
      { toolCallId: "opaque-grep", toolName: "grep", input: { pattern: "x", cursor: "fff_c1" } },
      { toolCallId: "opaque-find", toolName: "find", input: { pattern: "x", cursor: "fff_f1" } }
    ]) {
      await expect(handler(call, { hasUI: true })).resolves.toEqual({
        block: true,
        reason: "无法验证分页游标对应的搜索根目录；请不带 cursor 重新执行搜索。"
      });
    }

    expect(requestApproval.mock.calls.map(([request]) => request.category)).toEqual([
      "unverified-tool",
      "unverified-tool",
      "unverified-tool"
    ]);
    expect(requestApproval).toHaveBeenCalledTimes(3);
  });

  it("blocks duplicate, wrong-version, and extension sources without meaningless approval", async () => {
    const workspace = await createWorkspace();
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    let tools = [piFffTool("grep"), piFffTool("grep")];
    const handler = safetyHandler(autoPolicy(workspace), requestApproval, () => tools);

    await expect(handler({
      toolCallId: "duplicate",
      toolName: "grep",
      input: { pattern: "x" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "当前 Tool 存在多个同名来源，授权无法消除歧义；请移除重复来源并重新加载。"
    });

    tools = [packageTool("grep", "npm:@ff-labs/pi-fff@0.10.0")];
    await expect(handler({
      toolCallId: "wrong-version",
      toolName: "grep",
      input: { pattern: "x" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "Tool `grep` 未通过 @ff-labs/pi-fff 的 Desktop 身份校验；请检查 Package 版本和重复来源。"
    });

    tools = [extensionTool("grep")];
    await expect(handler({
      toolCallId: "extension-source",
      toolName: "grep",
      input: { pattern: "x" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: "Tool `grep` 未通过 @ff-labs/pi-fff 的 Desktop 身份校验；请检查 Package 版本和重复来源。"
    });

    expect(requestApproval).not.toHaveBeenCalled();
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-fff-workspace-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}

function autoPolicy(cwd: string): SafetyPolicyState {
  return { cwd, trust: "trusted", approvalMode: "balanced", taskToolMode: "auto" };
}

function safetyHandler(
  policy: SafetyPolicyState,
  requestApproval: DesktopApprovalRequester,
  getTools: () => ReturnType<ExtensionAPI["getAllTools"]>
): SafetyHandler {
  let handler: SafetyHandler | undefined;
  const api = {
    getAllTools: getTools,
    getActiveTools: () => getTools().map((tool) => tool.name),
    on(event: string, candidate: SafetyHandler) {
      if (event === "tool_call") handler = candidate;
    }
  } as unknown as ExtensionAPI;
  const extension = createDesktopSafetyExtension(() => policy, requestApproval);
  if (!("factory" in extension)) throw new Error("Expected the Desktop safety extension factory.");
  void extension.factory(api);
  if (!handler) throw new Error("Desktop safety extension did not register a tool_call handler.");
  return handler;
}

function piFffTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return packageTool(name, "npm:@ff-labs/pi-fff@0.10.1");
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

function extensionTool(name: string): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name,
    description: name,
    parameters: { type: "object" },
    sourceInfo: { path: `/extensions/${name}.ts`, source: "extension", scope: "user", origin: "top-level" }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
