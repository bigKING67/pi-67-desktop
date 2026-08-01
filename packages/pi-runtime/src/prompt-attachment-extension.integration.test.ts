import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  createAgentSessionFromServices
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import {
  DESKTOP_ATTACHMENT_EXTENSION_PATH,
  DESKTOP_ATTACHMENT_TOOL_NAME
} from "./prompt-attachment-extension.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";
import { createDesktopSessionServices } from "./session-services.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Desktop prompt attachment Extension integration", () => {
  it("registers the hidden Tool with a verifiable source and bypasses approval only for that exact Tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-attachment-extension-"));
    roots.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    const read = vi.fn<PromptAttachmentAccess["read"]>().mockResolvedValue({
      text: "fixture attachment text",
      details: {
        operation: "read_text",
        setId: "set_a",
        attachmentId: "attachment_a",
        truncated: false
      }
    });
    const access: PromptAttachmentAccess = {
      claim: vi.fn(async () => undefined),
      readImages: vi.fn(async () => []),
      read
    };
    const requestApproval = vi.fn(async () => ({ status: "denied" as const }));
    const services = await createDesktopSessionServices({
      cwd,
      agentDir,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided" }),
      requestApproval,
      promptAttachmentAccess: access
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd)
    });
    const bridge = new DesktopExtensionUiBridge(() => undefined);

    try {
      await session.bindExtensions({ uiContext: bridge.context, mode: "rpc" });
      const matches = session.getAllTools().filter((tool) => tool.name === DESKTOP_ATTACHMENT_TOOL_NAME);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.sourceInfo).toMatchObject({
        path: DESKTOP_ATTACHMENT_EXTENSION_PATH,
        source: "inline",
        scope: "temporary",
        origin: "top-level"
      });

      const input = {
        setId: "set_a",
        operation: "read_text" as const,
        attachmentId: "attachment_a"
      };
      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "attachment-tool-call",
        toolName: DESKTOP_ATTACHMENT_TOOL_NAME,
        input
      })).resolves.toBeUndefined();
      expect(requestApproval).not.toHaveBeenCalled();

      const tool = session.getToolDefinition(DESKTOP_ATTACHMENT_TOOL_NAME);
      if (!tool) throw new Error("Expected Desktop attachment Tool.");
      await expect(tool.execute(
        "attachment-tool-call",
        input,
        undefined,
        undefined,
        {} as never
      )).resolves.toEqual({
        content: [{ type: "text", text: "fixture attachment text" }],
        details: expect.objectContaining({
          operation: "read_text",
          setId: "set_a",
          attachmentId: "attachment_a"
        })
      });
      expect(read).toHaveBeenCalledWith(input, undefined);
    } finally {
      bridge.dispose();
      session.dispose();
    }
  }, 15_000);
});
