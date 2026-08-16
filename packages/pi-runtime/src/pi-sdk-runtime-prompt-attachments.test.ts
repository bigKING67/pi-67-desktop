import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import type {
  PreparedPromptAttachmentSet,
  PromptAttachmentAccess
} from "./prompt-attachment.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime prompt attachments", () => {
  it("claims opaque refs by stable submission id and fails closed without attachment access", async () => {
    const set = attachmentSet();
    const claim = vi.fn(async () => set);
    const runtime = new PiSdkRuntime({ promptAttachmentAccess: attachmentAccess({ claim }) });

    await expect(runtime.preparePromptAttachments("submission_a", [])).resolves.toBeUndefined();
    await expect(runtime.preparePromptAttachments("submission_a", [{ id: "draft_attachment_a" }]))
      .resolves.toBe(set);
    expect(claim).toHaveBeenCalledWith("submission_a", [{ id: "draft_attachment_a" }]);

    const unavailable = new PiSdkRuntime();
    await expect(unavailable.preparePromptAttachments("submission_a", [{ id: "draft_attachment_a" }]))
      .rejects.toThrow("staging is unavailable");
    await runtime.dispose();
    await unavailable.dispose();
  });

  it("injects hidden metadata before the user prompt and passes images through Pi native content", async () => {
    const order: string[] = [];
    const images = imageContents();
    const readImages = vi.fn(async () => {
      order.push("images");
      return images;
    });
    const access = attachmentAccess({
      readImages
    });
    const fixture = await initializedRuntime(access);
    const customMessage = vi.spyOn(fixture.session, "sendCustomMessage").mockImplementation(async () => {
      order.push("custom");
    });
    const prompt = vi.spyOn(fixture.session, "prompt").mockImplementation(async () => {
      order.push("prompt");
    });

    try {
      await fixture.runtime.submitPrompt("Inspect the attachments", attachmentSet());

      expect(order).toEqual(["images", "custom", "prompt"]);
      expect(readImages).toHaveBeenCalledWith("attachment_set_a");
      expect(customMessage).toHaveBeenCalledWith({
        customType: "pi67.desktop-attachments.v1",
        content: expect.stringContaining("read_attachment"),
        display: false,
        details: attachmentSet()
      }, { triggerTurn: false });
      expect(prompt).toHaveBeenCalledWith("Inspect the attachments", { images });
    } finally {
      await fixture.runtime.dispose();
    }
  });

  it("uses the matching Pi queue delivery for attachment metadata and images", async () => {
    const images = imageContents();
    const access = attachmentAccess({ readImages: vi.fn(async () => images) });
    const fixture = await initializedRuntime(access);
    const customMessage = vi.spyOn(fixture.session, "sendCustomMessage").mockResolvedValue();
    const steer = vi.spyOn(fixture.session, "steer").mockResolvedValue();
    const followUp = vi.spyOn(fixture.session, "followUp").mockResolvedValue();

    try {
      await fixture.runtime.steer("Correct course", attachmentSet());
      expect(customMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ customType: "pi67.desktop-attachments.v1", display: false }),
        { deliverAs: "steer" }
      );
      expect(steer).toHaveBeenCalledWith("Correct course", images);

      await fixture.runtime.followUp("Continue later", attachmentSet());
      expect(customMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ customType: "pi67.desktop-attachments.v1", display: false }),
        { deliverAs: "followUp" }
      );
      expect(followUp).toHaveBeenCalledWith("Continue later", images);
    } finally {
      await fixture.runtime.dispose();
    }
  });

  it("does not persist hidden attachment metadata when image preparation fails", async () => {
    const failure = new Error("staged image is unavailable");
    const access = attachmentAccess({ readImages: vi.fn().mockRejectedValue(failure) });
    const fixture = await initializedRuntime(access);
    const customMessage = vi.spyOn(fixture.session, "sendCustomMessage").mockResolvedValue();
    const prompt = vi.spyOn(fixture.session, "prompt").mockResolvedValue();

    try {
      await expect(fixture.runtime.submitPrompt("Inspect", attachmentSet())).rejects.toBe(failure);
      expect(customMessage).not.toHaveBeenCalled();
      expect(prompt).not.toHaveBeenCalled();
    } finally {
      await fixture.runtime.dispose();
    }
  });
});

async function initializedRuntime(access: PromptAttachmentAccess): Promise<{
  runtime: PiSdkRuntime;
  session: AgentSession;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi67-runtime-attachments-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  const runtime = new PiSdkRuntime({ promptAttachmentAccess: access });
  await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
  const session = (runtime as unknown as {
    sessionBindings: { requireSession(): AgentSession };
  }).sessionBindings.requireSession();
  Object.defineProperty(session, "model", {
    configurable: true,
    value: { input: ["text", "image"] }
  });
  return { runtime, session };
}

function attachmentAccess(overrides: Partial<PromptAttachmentAccess> = {}): PromptAttachmentAccess {
  return {
    claim: async () => attachmentSet(),
    readImages: async () => imageContents(),
    read: async (request) => ({
      text: "attachment",
      details: {
        operation: request.operation,
        setId: request.setId,
        ...(request.attachmentId === undefined ? {} : { attachmentId: request.attachmentId }),
        truncated: false
      }
    }),
    ...overrides
  };
}

function attachmentSet(): PreparedPromptAttachmentSet {
  return {
    id: "attachment_set_a",
    attachments: [
      {
        id: "image_a",
        name: "diagram.png",
        mimeType: "image/png",
        byteLength: 3,
        kind: "image"
      },
      {
        id: "document_a",
        name: "brief.txt",
        mimeType: "text/plain",
        byteLength: 24,
        kind: "document"
      }
    ]
  };
}

function imageContents(): ImageContent[] {
  return [{ type: "image", mimeType: "image/png", data: "AQID" }];
}
