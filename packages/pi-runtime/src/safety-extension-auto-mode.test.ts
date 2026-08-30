import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApprovalRequester } from "./safety-extension.js";
import { safetyHandler, trustedPolicy } from "./safety-extension-test-fixture.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop AUTO and YOLO safety order", () => {
  it("auto-allows Workspace-local dependency changes but not global installs", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = safetyHandler({
      ...trustedPolicy(),
      approvalMode: "balanced",
      taskToolMode: "auto"
    }, requestApproval);

    await expect(handler({
      toolCallId: "tool-call-local-install",
      toolName: "bash",
      input: { command: "pnpm install" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(handler({
      toolCallId: "tool-call-global-install",
      toolName: "bash",
      input: { command: "npm install --global fixture" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    expect(requestApproval).toHaveBeenCalledOnce();
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "system-configuration",
      toolCallId: "tool-call-global-install"
    }), expect.any(Object));
  });

  it("auto-allows verified absolute workspace paths with bounded stderr handling", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi67-shell-workspace-"));
    temporaryDirectories.push(workspace);
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const recordToolAuthorization = vi.fn();
    const handler = safetyHandler({
      ...trustedPolicy(),
      cwd: workspace,
      approvalMode: "balanced",
      taskToolMode: "auto"
    }, requestApproval, undefined, undefined, recordToolAuthorization);

    await expect(handler({
      toolCallId: "tool-call-absolute-workspace",
      toolName: "bash",
      input: { command: `ls ${workspace} 2>&1 | head -n 30; ls ${workspace}/temp 2>/dev/null` }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(recordToolAuthorization).toHaveBeenCalledWith(
      "tool-call-absolute-workspace",
      "workspace-command"
    );
  });

  it("keeps canonical workspace-external and symlink-escape Shell paths behind approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi67-shell-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "pi67-shell-outside-"));
    temporaryDirectories.push(workspace, outside);
    const escapeLink = join(workspace, "escape-link");
    await symlink(outside, escapeLink, process.platform === "win32" ? "junction" : "dir");
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const handler = safetyHandler({
      ...trustedPolicy(),
      cwd: workspace,
      approvalMode: "balanced",
      taskToolMode: "auto"
    }, requestApproval);

    await expect(handler({
      toolCallId: "tool-call-external-path",
      toolName: "bash",
      input: { command: `ls ${outside}` }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    await expect(handler({
      toolCallId: "tool-call-symlink-escape",
      toolName: "bash",
      input: { command: `ls ${escapeLink}` }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenNthCalledWith(1, expect.objectContaining({
      category: "external-path"
    }), expect.anything());
    expect(requestApproval).toHaveBeenNthCalledWith(2, expect.objectContaining({
      category: "external-path"
    }), expect.anything());
  });

  it("corrects unsupported AUTO Shell control flow without opening an approval dialog", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const handler = safetyHandler({
      ...trustedPolicy(),
      approvalMode: "balanced",
      taskToolMode: "auto"
    }, requestApproval);

    await expect(handler({
      toolCallId: "tool-call-loop",
      toolName: "bash",
      input: { command: "B=references; for f in one two; do test -f $B/$f; done" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).not.toHaveBeenCalled();
    await expect(handler({
      toolCallId: "tool-call-loop-second",
      toolName: "bash",
      input: { command: "for f in one two; do cat $f; done" }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("Shell 控制流、变量或命令展开")
    });
  });

  it("keeps recognized destructive operations behind confirmation in trusted YOLO", async () => {
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "allowed" });
    const handler = safetyHandler(
      { ...trustedPolicy(), approvalMode: "balanced", taskToolMode: "yolo" },
      requestApproval
    );

    await expect(handler({
      toolCallId: "yolo-system",
      toolName: "bash",
      input: { command: "sudo chmod 600 fixture.txt" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(handler({
      toolCallId: "yolo-delete",
      toolName: "bash",
      input: { command: "rm -rf build" }
    }, { hasUI: true })).resolves.toBeUndefined();

    expect(requestApproval).toHaveBeenCalledOnce();
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "bulk-delete",
      toolCallId: "yolo-delete"
    }), expect.any(Object));
  });
});
