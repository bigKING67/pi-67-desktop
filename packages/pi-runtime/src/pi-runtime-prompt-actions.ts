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
  generateSemanticTitle: () => void;
}

export class PiRuntimePromptActions {
  constructor(private readonly options: PiRuntimePromptActionsOptions) {}

  async submit(
    text: string,
    attachments?: PreparedPromptAttachmentSet,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
    await this.options.assertWritable();
    signal?.throwIfAborted();
    await this.options.configurationReload.assertReady();
    signal?.throwIfAborted();
    const session = this.options.sessionBindings.requireSession();
    let completed = false;
    try {
      await this.options.promptAttachments.submit(session, text, attachments, signal);
      completed = true;
    } finally {
      await this.options.sessionCatalog.upsertCurrent("session-updated");
      await this.options.configurationReload.apply();
    }
    if (completed) this.options.generateSemanticTitle();
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
