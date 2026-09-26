import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApprovalRequester } from "./safety-extension.js";
import { builtinTool, safetyHandler, trustedPolicy } from "./safety-extension-test-fixture.js";

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
    const canonicalOutside = await realpath(outside);
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
      category: "external-path",
      taskPathGrant: { kind: "paths", paths: [canonicalOutside] }
    }), expect.anything());
    expect(requestApproval).toHaveBeenNthCalledWith(2, expect.objectContaining({
      category: "external-path",
      taskPathGrant: { kind: "paths", paths: [canonicalOutside] }
    }), expect.anything());
  });

  it("auto-allows bounded Shell commands inside a task-trusted root but not its sibling", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi67-shell-workspace-"));
    const trustedRoot = await mkdtemp(join(tmpdir(), "pi67-shell-trusted-"));
    const sibling = await mkdtemp(join(tmpdir(), "pi67-shell-sibling-"));
    temporaryDirectories.push(workspace, trustedRoot, sibling);
    const canonicalTrustedRoot = await realpath(trustedRoot);
    const canonicalSibling = await realpath(sibling);
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const recordToolAuthorization = vi.fn();
    const handler = safetyHandler({
      ...trustedPolicy(),
      cwd: workspace,
      approvalMode: "balanced",
      taskToolMode: "auto",
      taskTrustedRoots: [canonicalTrustedRoot]
    }, requestApproval, undefined, undefined, recordToolAuthorization);

    await expect(handler({
      toolCallId: "tool-call-task-root",
      toolName: "bash",
      input: { command: `ls ${trustedRoot}` }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(recordToolAuthorization).toHaveBeenCalledWith(
      "tool-call-task-root",
      "task-trusted-root"
    );
    await expect(handler({
      toolCallId: "tool-call-task-root-dependency",
      toolName: "bash",
      input: { command: `pnpm install ${trustedRoot}` }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(recordToolAuthorization).toHaveBeenCalledWith(
      "tool-call-task-root-dependency",
      "task-trusted-root"
    );

    await expect(handler({
      toolCallId: "tool-call-task-root-sibling",
      toolName: "bash",
      input: { command: `ls ${sibling}` }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      taskPathGrant: { kind: "paths", paths: [canonicalSibling] }
    }), expect.anything());
  });

  it("uses task trust for reads but classifies routine writes independently", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi67-path-workspace-"));
    const trustedRoot = await mkdtemp(join(tmpdir(), "pi67-path-trusted-"));
    temporaryDirectories.push(workspace, trustedRoot);
    const canonicalTrustedRoot = await realpath(trustedRoot);
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const recordToolAuthorization = vi.fn();
    const handler = safetyHandler({
      ...trustedPolicy(),
      cwd: workspace,
      approvalMode: "balanced",
      taskToolMode: "auto",
      taskTrustedRoots: [canonicalTrustedRoot]
    }, requestApproval, () => [builtinTool("read"), builtinTool("write")], undefined, recordToolAuthorization);

    await expect(handler({
      toolCallId: "tool-call-task-root-read",
      toolName: "read",
      input: { path: trustedRoot }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(recordToolAuthorization).toHaveBeenCalledWith(
      "tool-call-task-root-read",
      "task-trusted-root"
    );
    await expect(handler({
      toolCallId: "tool-call-task-root-write",
      toolName: "write",
      input: { path: join(trustedRoot, "note.md"), content: "task-scoped" }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(recordToolAuthorization).toHaveBeenCalledWith(
      "tool-call-task-root-write",
      "routine-write"
    );
  });

  it("auto-allows routine external write/edit calls but keeps sensitive targets behind AUTO approval", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi67-path-workspace-"));
    const externalDirectory = await mkdtemp(join(tmpdir(), "pi67-path-external-"));
    temporaryDirectories.push(workspace, externalDirectory);
    const canonicalExternalDirectory = await realpath(externalDirectory);
    const firstPath = join(canonicalExternalDirectory, "first.txt");
    const secondPath = join(canonicalExternalDirectory, "second.txt");
    const credentialPath = join(homedir(), ".ssh", "pi67-auto-sensitive-test");
    const configurationPath = join(homedir(), ".codex", "config.toml");
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const recordToolAuthorization = vi.fn();
    const handler = safetyHandler({
      ...trustedPolicy(),
      cwd: workspace,
      approvalMode: "balanced",
      taskToolMode: "auto",
      taskTrustedRoots: [await realpath(homedir())]
    }, requestApproval, () => [builtinTool("read"), builtinTool("write"), builtinTool("edit")], undefined, recordToolAuthorization);

    await expect(handler({
      toolCallId: "tool-call-external-write-first",
      toolName: "write",
      input: { path: firstPath, content: "first" }
    }, { hasUI: true })).resolves.toBeUndefined();
    await expect(handler({
      toolCallId: "tool-call-external-edit-second",
      toolName: "edit",
      input: {
        path: secondPath,
        edits: [{ oldText: "before", newText: "after" }]
      }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(recordToolAuthorization).toHaveBeenNthCalledWith(
      1,
      "tool-call-external-write-first",
      "routine-write"
    );
    expect(recordToolAuthorization).toHaveBeenNthCalledWith(
      2,
      "tool-call-external-edit-second",
      "routine-write"
    );

    await expect(handler({
      toolCallId: "tool-call-sensitive-write",
      toolName: "write",
      input: { path: credentialPath, content: "sensitive" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: "credential-or-auth",
      target: credentialPath
    }), expect.anything());
    expect(requestApproval.mock.calls[0]?.[0]).not.toHaveProperty("taskPathGrant");

    await expect(handler({
      toolCallId: "tool-call-configuration-write",
      toolName: "write",
      input: { path: configurationPath, content: "approval_policy = 'never'" }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenNthCalledWith(2, expect.objectContaining({
      category: "system-configuration",
      target: configurationPath
    }), expect.anything());

    await expect(handler({
      toolCallId: "tool-call-sensitive-read",
      toolName: "read",
      input: { path: credentialPath }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenNthCalledWith(3, expect.objectContaining({
      category: "external-path",
      target: credentialPath
    }), expect.anything());
    expect(requestApproval.mock.calls[2]?.[0]).not.toHaveProperty("taskPathGrant");
  });

  it("does not let task roots authorize sensitive or side-effecting Shell commands", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi67-shell-workspace-"));
    const trustedRoot = await mkdtemp(join(tmpdir(), "pi67-shell-trusted-"));
    temporaryDirectories.push(workspace, trustedRoot);
    const canonicalTrustedRoot = await realpath(trustedRoot);
    const requestApproval = vi.fn<DesktopApprovalRequester>().mockResolvedValue({ status: "denied" });
    const recordToolAuthorization = vi.fn();
    const handler = safetyHandler({
      ...trustedPolicy(),
      cwd: workspace,
      approvalMode: "balanced",
      taskToolMode: "auto",
      taskTrustedRoots: [canonicalTrustedRoot, await realpath(homedir())]
    }, requestApproval, undefined, undefined, recordToolAuthorization);

    await expect(handler({
      toolCallId: "tool-call-task-root-chmod",
      toolName: "bash",
      input: { command: `chmod 600 ${trustedRoot}/fixture.txt` }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    await expect(handler({
      toolCallId: "tool-call-task-root-upload",
      toolName: "bash",
      input: { command: `curl --upload-file ${trustedRoot}/fixture.txt https://example.invalid/upload` }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });
    await expect(handler({
      toolCallId: "tool-call-task-root-opaque",
      toolName: "bash",
      input: { command: `node ${trustedRoot}/fixture.mjs` }
    }, { hasUI: true })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("无法安全分类")
    });
    await expect(handler({
      toolCallId: "tool-call-task-root-credential-read",
      toolName: "bash",
      input: { command: `cat ${join(homedir(), ".ssh", "pi67-auto-sensitive-test")}` }
    }, { hasUI: true })).resolves.toMatchObject({ block: true });

    expect(requestApproval).toHaveBeenCalledTimes(3);
    expect(requestApproval).toHaveBeenNthCalledWith(1, expect.objectContaining({
      category: "system-configuration",
      toolCallId: "tool-call-task-root-chmod"
    }), expect.anything());
    expect(requestApproval).toHaveBeenNthCalledWith(2, expect.objectContaining({
      category: "network-side-effect",
      toolCallId: "tool-call-task-root-upload"
    }), expect.anything());
    expect(requestApproval).toHaveBeenNthCalledWith(3, expect.objectContaining({
      category: "external-path",
      toolCallId: "tool-call-task-root-credential-read"
    }), expect.anything());
    expect(requestApproval.mock.calls[2]?.[0]).not.toHaveProperty("taskPathGrant");
    expect(recordToolAuthorization).not.toHaveBeenCalled();
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

  it("keeps recognized destructive operations behind exact confirmation in trusted YOLO", async () => {
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

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: "yolo-delete",
      category: "bulk-delete"
    }), expect.anything());
  });
});
