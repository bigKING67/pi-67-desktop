import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyConfiguredToolIntent } from "./configured-tool-safety.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("classifyConfiguredToolIntent", () => {
  it("allows ordinary configured Package tools and read-only Web tools", async () => {
    const workspace = await fixtureWorkspace();
    await expect(classify("subagent", {}, workspace)).resolves.toMatchObject({
      category: "configured-operation"
    });
    await expect(classify("web_fetch", { url: "https://example.invalid" }, workspace)).resolves.toMatchObject({
      category: "network-read"
    });
  });

  it("separates Memory additions from destructive deletion", async () => {
    const workspace = await fixtureWorkspace();
    await expect(classify("remember", {}, workspace, "agent_memory")).resolves.toMatchObject({
      category: "persistent-state-write"
    });
    await expect(classify("learn", {}, workspace, "agent_memory")).resolves.toMatchObject({
      category: "persistent-state-write"
    });
    await expect(classify("forget", {}, workspace, "agent_memory")).resolves.toMatchObject({
      category: "persistent-state-delete"
    });
    await expect(classify("memory_delete_probe", {}, workspace, "agent_memory")).resolves.toMatchObject({
      category: "persistent-state-delete"
    });
  });

  it("classifies declared file and external deletion as hard-stop effects", async () => {
    const workspace = await fixtureWorkspace();
    await expect(classify("file_ops", { action: "delete_file" }, workspace)).resolves.toMatchObject({
      category: "bulk-delete"
    });
    await expect(classify("delete_repository", {}, workspace)).resolves.toMatchObject({
      category: "external-delete"
    });
    await expect(classify("delete_file", {
      path: join(workspace, "..", "outside.txt")
    }, workspace)).resolves.toMatchObject({
      category: "bulk-delete",
      targetKind: "path"
    });
  });

  it("keeps passive Browser operations automatic while isolating active input, upload, and auth", async () => {
    const workspace = await fixtureWorkspace();
    for (const [toolName, input, category] of [
      ["browser_scan", { action: "snapshot" }, "configured-operation"],
      ["browser_file_ops", { action: "inspect_inputs" }, "configured-operation"],
      ["browser_file_ops", { action: "set_input_files" }, "external-submit"],
      ["browser_file_ops", { action: "delete_file" }, "bulk-delete"],
      ["browser_execute_js", {}, "external-submit"],
      ["browser_native_input", { action: "click" }, "external-submit"],
      ["browser_clipboard_ops", { action: "write_text" }, "external-submit"],
      ["browser_auth_ops", { action: "ensure_login" }, "credential-or-auth"]
    ] as const) {
      await expect(classify(toolName, input, workspace, "tmwd_browser")).resolves.toMatchObject({ category });
    }
  });

  it("keeps downloads automatic but preserves the Workspace path boundary", async () => {
    const workspace = await fixtureWorkspace();
    await expect(classify("browser_download_ops", {
      action: "prepare",
      download_dir: "downloads"
    }, workspace, "tmwd_browser")).resolves.toMatchObject({ category: "configured-operation" });
    await expect(classify("browser_download_ops", {
      action: "prepare",
      download_dir: join(workspace, "..", "outside")
    }, workspace, "tmwd_browser")).resolves.toMatchObject({
      category: "external-path",
      targetKind: "path"
    });
  });

  it("allows task-scoped JS-Reverse instrumentation without broad delete-name heuristics", async () => {
    const workspace = await fixtureWorkspace();
    for (const toolName of ["inject_hook", "remove_hook", "set_breakpoint", "finalize_task"]) {
      await expect(classify(toolName, {}, workspace, "js-reverse")).resolves.toMatchObject({
        category: "configured-operation"
      });
    }
  });
});

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-configured-tool-safety-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "downloads"), { recursive: true });
  await writeFile(join(root, "README.md"), "fixture", "utf8");
  return realpath(root);
}

function classify(
  toolName: string,
  input: Record<string, unknown>,
  workspace: string,
  serverName?: string
) {
  return classifyConfiguredToolIntent({
    toolName,
    input,
    workspace,
    sourceLabel: serverName ? `MCP · ${serverName}` : "已配置 Package",
    ...(serverName === undefined ? {} : { serverName, remoteToolName: toolName })
  });
}
