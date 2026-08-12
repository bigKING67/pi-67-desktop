import type { PreparedPromptAttachmentSet } from "./prompt-attachment.js";
import type { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";
import type { RuntimePromptAttachments } from "./runtime-prompt-attachments.js";
import type { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import type { createRuntimeSessionCatalog } from "./runtime-session-catalog.js";
import { clearSessionQueue } from "./session-queue.js";

interface PiRuntimePromptActionsOptions {
  sessionBindings: RuntimeSessionBindings;
  sessionCatalog: ReturnType<typeof createRuntimeSessionCatalog>;
  configurationReload: PiRuntimeConfigurationReload;
  promptAttachments: RuntimePromptAttachments;
  assertWritable: () => Promise<void>;
}

export class PiRuntimePromptActions {
  constructor(private readonly options: PiRuntimePromptActionsOptions) {}

  async submit(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void> {
    await this.options.assertWritable();
    await this.options.configurationReload.assertReady();
    const session = this.options.sessionBindings.requireSession();
    try {
      await this.options.promptAttachments.submit(session, text, attachments);
    } finally {
      await this.options.sessionCatalog.upsertCurrent("session-updated");
      await this.options.configurationReload.apply();
    }
  }

  async steer(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void> {
    await this.options.assertWritable();
    await this.options.configurationReload.assertReady();
    await this.options.promptAttachments.steer(
      this.options.sessionBindings.requireSession(),
      text,
      attachments
    );
  }

  async followUp(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void> {
    await this.options.assertWritable();
    await this.options.configurationReload.assertReady();
    await this.options.promptAttachments.followUp(
      this.options.sessionBindings.requireSession(),
      text,
      attachments
    );
  }

  clearQueue() {
    return clearSessionQueue(this.options.sessionBindings.requireSession());
  }

  async invokeCommand(command: string): Promise<void> {
    await this.options.assertWritable();
    await this.options.configurationReload.assertReady();
    const normalized = command.startsWith("/") ? command : `/${command}`;
    const session = this.options.sessionBindings.requireSession();
    try {
      await session.prompt(normalized, session.isStreaming ? { streamingBehavior: "followUp" } : {});
    } finally {
      await this.options.sessionCatalog.upsertCurrent("session-updated");
      await this.options.configurationReload.apply();
    }
  }
}
