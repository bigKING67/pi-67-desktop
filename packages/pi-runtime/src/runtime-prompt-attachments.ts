import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type { PromptAttachmentRef } from "@pi67/protocol";
import {
  promptAttachmentMessage,
  type PreparedPromptAttachmentSet,
  type PromptAttachmentAccess
} from "./prompt-attachment.js";

export class RuntimePromptAttachments {
  constructor(private readonly access: PromptAttachmentAccess | undefined) {}

  claim(
    submissionId: string,
    refs: readonly PromptAttachmentRef[]
  ): Promise<PreparedPromptAttachmentSet | undefined> {
    if (refs.length === 0) return Promise.resolve(undefined);
    if (!this.access) {
      throw new RuntimeError("RESOURCE_NOT_FOUND", "Prompt attachment staging is unavailable.");
    }
    return this.access.claim(submissionId, refs);
  }

  async submit(
    session: AgentSession,
    text: string,
    attachments?: PreparedPromptAttachmentSet
  ): Promise<void> {
    const images = await this.images(attachments);
    if (attachments) {
      await session.sendCustomMessage(promptAttachmentMessage(attachments), { triggerTurn: false });
    }
    await session.prompt(text, {
      images,
      ...(session.isStreaming ? { streamingBehavior: "followUp" as const } : {})
    });
  }

  async steer(
    session: AgentSession,
    text: string,
    attachments?: PreparedPromptAttachmentSet
  ): Promise<void> {
    const images = await this.images(attachments);
    if (attachments) {
      await session.sendCustomMessage(promptAttachmentMessage(attachments), { deliverAs: "steer" });
    }
    await session.steer(text, images);
  }

  async followUp(
    session: AgentSession,
    text: string,
    attachments?: PreparedPromptAttachmentSet
  ): Promise<void> {
    const images = await this.images(attachments);
    if (attachments) {
      await session.sendCustomMessage(promptAttachmentMessage(attachments), { deliverAs: "followUp" });
    }
    await session.followUp(text, images);
  }

  private images(attachments: PreparedPromptAttachmentSet | undefined) {
    return attachments && this.access ? this.access.readImages(attachments.id) : Promise.resolve([]);
  }
}
