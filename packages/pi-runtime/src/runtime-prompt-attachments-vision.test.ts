import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type {
  PreparedPromptAttachmentSet,
  PromptAttachmentAccess
} from "./prompt-attachment.js";
import { RuntimePromptAttachments } from "./runtime-prompt-attachments.js";
import {
  VISION_ASSISTANCE_CONTEXT_TYPE,
  VISION_ASSISTANCE_ENTRY_TYPE
} from "./vision-assistance.js";

describe("RuntimePromptAttachments visual assistance", () => {
  it("describes images before Session writes and sends only derived text to a text-only model", async () => {
    const order: string[] = [];
    const completeSimple = vi.fn(async () => {
      order.push("vision");
      return visualResponse();
    });
    const fixture = sessionFixture({ mainInput: ["text"], completeSimple, order });
    const attachments = runtimeAttachments(async () => ({ provider: "vision", model: "vision-model" }));

    await attachments.submit(fixture.session, "Explain this error", attachmentSet());

    expect(order).toEqual(["vision", "attachment-context", "evidence", "vision-context", "prompt"]);
    expect(completeSimple).toHaveBeenCalledWith(
      visionModel(),
      expect.objectContaining({
        messages: [expect.objectContaining({
          content: expect.arrayContaining([expect.objectContaining({ type: "image", data: "AQID" })])
        })]
      }),
      expect.objectContaining({ maxTokens: 4_096 })
    );
    expect(fixture.appendCustomEntry).toHaveBeenCalledWith(
      VISION_ASSISTANCE_ENTRY_TYPE,
      expect.objectContaining({
        provider: "vision",
        model: "vision-model",
        description: "A settings page shows a Workspace initialization error."
      })
    );
    expect(JSON.stringify(fixture.appendCustomEntry.mock.calls)).not.toContain("AQID");
    expect(fixture.sendCustomMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customType: VISION_ASSISTANCE_CONTEXT_TYPE,
        content: expect.stringContaining("Workspace initialization error"),
        display: false
      }),
      { triggerTurn: false }
    );
    expect(fixture.prompt).toHaveBeenCalledWith("Explain this error", { images: [] });
  });

  it("fails before any Session write or main-model call when the helper Provider fails", async () => {
    const fixture = sessionFixture({
      mainInput: ["text"],
      completeSimple: vi.fn().mockRejectedValue(new Error("vision quota exceeded")),
      order: []
    });
    const attachments = runtimeAttachments(async () => ({ provider: "vision", model: "vision-model" }));

    await expect(attachments.submit(fixture.session, "Inspect", attachmentSet()))
      .rejects.toThrow("Visual assistance failed: vision quota exceeded");
    expect(fixture.appendCustomEntry).not.toHaveBeenCalled();
    expect(fixture.sendCustomMessage).not.toHaveBeenCalled();
    expect(fixture.prompt).not.toHaveBeenCalled();
  });

  it("points an unconfigured text-only image request to Visual Assistance settings", async () => {
    const fixture = sessionFixture({
      mainInput: ["text"],
      completeSimple: vi.fn(),
      order: []
    });
    const attachments = runtimeAttachments(async () => undefined);

    await expect(attachments.submit(fixture.session, "Inspect", attachmentSet()))
      .rejects.toThrow("Settings > Visual Assistance");
    expect(fixture.appendCustomEntry).not.toHaveBeenCalled();
    expect(fixture.sendCustomMessage).not.toHaveBeenCalled();
    expect(fixture.prompt).not.toHaveBeenCalled();
  });

  it("keeps native image delivery primary for image-capable chat models", async () => {
    const resolver = vi.fn(async () => ({ provider: "vision", model: "vision-model" }));
    const fixture = sessionFixture({
      mainInput: ["text", "image"],
      completeSimple: vi.fn(),
      order: []
    });
    const attachments = runtimeAttachments(resolver);

    await attachments.submit(fixture.session, "Inspect", attachmentSet());

    expect(resolver).not.toHaveBeenCalled();
    expect(fixture.appendCustomEntry).not.toHaveBeenCalled();
    expect(fixture.prompt).toHaveBeenCalledWith("Inspect", {
      images: [{ type: "image", mimeType: "image/png", data: "AQID" }]
    });
  });
});

function runtimeAttachments(
  resolve: () => Promise<{ provider: string; model: string } | undefined>
): RuntimePromptAttachments {
  const access: PromptAttachmentAccess = {
    claim: async () => attachmentSet(),
    readImages: async () => [{ type: "image", mimeType: "image/png", data: "AQID" }],
    read: async () => ({ text: "", details: { operation: "list", setId: "set-a", truncated: false } })
  };
  return new RuntimePromptAttachments(access, resolve);
}

function sessionFixture({
  mainInput,
  completeSimple,
  order
}: {
  mainInput: Array<"text" | "image">;
  completeSimple: ReturnType<typeof vi.fn>;
  order: string[];
}) {
  const appendCustomEntry = vi.fn(() => {
    order.push("evidence");
    return "evidence-entry";
  });
  const sendCustomMessage = vi.fn(async (message: { customType: string }) => {
    order.push(message.customType === VISION_ASSISTANCE_CONTEXT_TYPE
      ? "vision-context"
      : "attachment-context");
  });
  const prompt = vi.fn(async () => { order.push("prompt"); });
  const session = {
    model: { input: mainInput },
    modelRuntime: {
      getModel: () => visionModel(),
      completeSimple
    },
    sessionManager: {
      getCwd: () => "/workspace",
      appendCustomEntry
    },
    isStreaming: false,
    sendCustomMessage,
    prompt
  } as unknown as AgentSession;
  return { session, appendCustomEntry, sendCustomMessage, prompt };
}

function attachmentSet(): PreparedPromptAttachmentSet {
  return {
    id: "set-a",
    attachments: [{
      id: "image-a",
      name: "settings.png",
      mimeType: "image/png",
      byteLength: 3,
      kind: "image"
    }]
  };
}

function visionModel(): Model<"openai-completions"> {
  return {
    id: "vision-model",
    name: "Vision Model",
    api: "openai-completions",
    provider: "vision",
    baseUrl: "https://vision.invalid/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192
  };
}

function visualResponse(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "A settings page shows a Workspace initialization error." }],
    api: "openai-completions",
    provider: "vision",
    model: "vision-model",
    usage: {
      input: 20,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0.001, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.002 }
    },
    stopReason: "stop",
    timestamp: 1
  };
}
