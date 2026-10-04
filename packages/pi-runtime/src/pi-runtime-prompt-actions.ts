import type { PreparedPromptAttachmentSet } from "./prompt-attachment.js";
import type { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";
import type { RuntimePromptAttachments } from "./runtime-prompt-attachments.js";
import type { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import type { createRuntimeSessionCatalog } from "./runtime-session-catalog.js";
import { clearSessionQueue } from "./session-queue.js";
import type { RuntimeResponseTimings } from "./runtime-response-timing.js";
import { continueInterruptedTask, inspectInterruptedTask } from "./interrupted-task-recovery.js";
import { observeShutdownPhase } from "./shutdown-phase-observation.js";

interface PiRuntimePromptActionsOptions {
  responseTimings?: RuntimeResponseTimings;
  sessionBindings: RuntimeSessionBindings;
  sessionCatalog: ReturnType<typeof createRuntimeSessionCatalog>;
  configurationReload: PiRuntimeConfigurationReload;
  promptAttachments: RuntimePromptAttachments;
  assertWritable: () => Promise<void>;
  generateSemanticTitle: () => void;
}

export class PiRuntimePromptActions {
  private shuttingDown = false;
  constructor(private readonly options: PiRuntimePromptActionsOptions) {}

  beginShutdown(): void { this.shuttingDown = true; }

  async submit(
    text: string,
    attachments?: PreparedPromptAttachmentSet,
    signal?: AbortSignal
  ): Promise<void> {
    const timing = this.options.responseTimings?.begin();
    let unsubscribe: (() => void) | undefined;
    let outcome: "resolved" | "rejected" = "rejected";
    try {
      signal?.throwIfAborted();
      await this.options.assertWritable();
      timing?.mark("sessionCheckedMs");
      signal?.throwIfAborted();
      await this.options.configurationReload.assertReady();
      timing?.mark("configurationReadyMs");
      signal?.throwIfAborted();
      const session = this.options.sessionBindings.requireSession();
      if (session.isStreaming) timing?.finish("queued");
      else if (timing) unsubscribe = session.subscribe(event => timing.observe(event));
      let completed = false;
      try {
        await this.options.promptAttachments.submit(session, text, attachments, signal,
          timing ? () => timing.mark("sdkPromptInvokedMs") : undefined);
        completed = true;
      } finally {
        await this.refreshAfterPrompt();
      }
      if (completed && !this.shuttingDown) this.options.generateSemanticTitle();
      outcome = "resolved";
    } finally {
      unsubscribe?.();
      timing?.finish(signal?.aborted ? "cancelled" : outcome);
    }
  }

  async steer(text: string, attachments?: PreparedPromptAttachmentSet, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.options.assertWritable();
    signal?.throwIfAborted();
    await this.options.configurationReload.assertReady();
    signal?.throwIfAborted();
    await this.options.promptAttachments.steer(
      this.options.sessionBindings.requireSession(),
      text,
      attachments,
      signal
    );
  }

  inspectInterrupted() { return inspectInterruptedTask(this.options.sessionBindings.requireSession()); }

  async continueInterrupted(anchor: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.options.assertWritable();
    signal?.throwIfAborted();
    await this.options.configurationReload.assertReady();
    signal?.throwIfAborted();
    const session = this.options.sessionBindings.requireSession();
    let aborting: Promise<void> | undefined;
    const abort = () => {
      aborting = session.abort();
      void aborting.catch(() => undefined); // Observed below, including when the run also rejects.
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await continueInterruptedTask(session, anchor);
    } finally {
      signal?.removeEventListener("abort", abort);
      await aborting;
      await this.refreshAfterPrompt();
    }
  }

  async followUp(text: string, attachments?: PreparedPromptAttachmentSet, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.options.assertWritable();
    signal?.throwIfAborted();
    await this.options.configurationReload.assertReady();
    signal?.throwIfAborted();
    await this.options.promptAttachments.followUp(
      this.options.sessionBindings.requireSession(),
      text,
      attachments,
      signal
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
      await this.refreshAfterPrompt();
    }
  }

  private async refreshAfterPrompt(): Promise<void> {
    if (this.shuttingDown) return;
    await observeShutdownPhase("operation-prompt-catalog", () => this.options.sessionCatalog.upsertCurrent("session-updated"));
    if (this.shuttingDown) return;
    await observeShutdownPhase("operation-prompt-configuration", () => this.options.configurationReload.apply());
  }
}
