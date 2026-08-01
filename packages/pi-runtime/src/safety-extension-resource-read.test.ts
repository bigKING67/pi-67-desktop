import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester
} from "./safety-extension.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop safety loaded-resource integration", () => {
  it("auto-allows a verified builtin read of a current-Session loaded resource", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-safety-resource-"));
    temporaryDirectories.push(root);
    const workspace = join(root, "workspace");
    const skillFile = join(root, "skill", "SKILL.md");
    await Promise.all([mkdir(workspace), mkdir(join(root, "skill"))]);
    await writeFile(skillFile, "# Loaded Skill");
    const canonicalSkillFile = await realpath(skillFile);
    const requestApproval = vi.fn<DesktopApprovalRequester>();
    const access: LoadedResourceReadAccess = {
      allows: (toolName, target) => toolName === "read" && target === canonicalSkillFile
    };
    let handler: ((event: {
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }, context: { hasUI: boolean }) => Promise<{ block?: boolean } | undefined>) | undefined;
    const extension = createDesktopSafetyExtension(
      () => ({
        cwd: workspace,
        trust: "trusted",
        approvalMode: "balanced",
        taskToolMode: "auto"
      }),
      requestApproval,
      access
    );
    if (!("factory" in extension)) throw new Error("Expected Desktop safety factory.");
    void extension.factory({
      getAllTools: () => [builtinReadTool()],
      getActiveTools: () => ["read"],
      on(event: string, candidate: typeof handler) {
        if (event === "tool_call") handler = candidate;
      }
    } as unknown as ExtensionAPI);
    if (!handler) throw new Error("Desktop safety handler was not registered.");

    await expect(handler({
      toolCallId: "tool-call-loaded-skill",
      toolName: "read",
      input: { path: skillFile }
    }, { hasUI: true })).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });
});

function builtinReadTool(): ReturnType<ExtensionAPI["getAllTools"]>[number] {
  return {
    name: "read",
    description: "read",
    parameters: { type: "object" },
    sourceInfo: {
      path: "<builtin:read>",
      source: "builtin",
      scope: "temporary",
      origin: "top-level"
    }
  } as ReturnType<ExtensionAPI["getAllTools"]>[number];
}
