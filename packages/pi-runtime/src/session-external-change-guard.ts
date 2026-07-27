import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import {
  SessionJsonlWatcher,
  type SessionJsonlExternalChange
} from "./session-jsonl-watcher.js";

export class SessionExternalChangeGuard {
  private readonly watcher = new SessionJsonlWatcher();
  private activeSession: AgentSession | undefined;
  private activeGeneration = 0;
  private conflict: SessionJsonlExternalChange | undefined;
  private abortFailed = false;

  async bind(
    session: AgentSession,
    generation: number,
    emit: (event: AgentEvent) => void
  ): Promise<void> {
    this.detach();
    const file = session.sessionFile;
    if (!file) return;
    this.activeSession = session;
    this.activeGeneration = generation;
    await this.watcher.bind({
      path: file,
      generation,
      getExpectedRecords: () => this.expectedRecords(session, generation),
      onExternalChange: (change) => {
        if (this.activeSession !== session || this.activeGeneration !== generation || this.conflict) return;
        this.conflict = change;
        emit({ type: "session.externalChangeDetected", payload: change });
        if (session.isStreaming) {
          void session.abort().catch(() => {
            if (this.activeSession === session && this.activeGeneration === generation) this.abortFailed = true;
          });
        }
      }
    });
  }

  detach(): void {
    this.watcher.dispose();
    this.activeSession = undefined;
    this.activeGeneration = 0;
    this.conflict = undefined;
    this.abortFailed = false;
  }

  async assertUnchanged(session: AgentSession | undefined): Promise<void> {
    if (!session?.sessionFile) return;
    if (this.activeSession === session) await this.watcher.checkNow();
    if (!this.conflict || this.activeSession !== session) return;
    throw new RuntimeError(
      "SESSION_CHANGED_EXTERNALLY",
      "The Pi session changed outside Desktop. Reload it before writing.",
      {
        recoverable: this.conflict.recoverable,
        details: {
          reason: this.conflict.reason,
          retryable: this.conflict.recoverable,
          ...(this.abortFailed ? { abortFailed: true } : {})
        }
      }
    );
  }

  private expectedRecords(session: AgentSession, generation: number): ReadonlyArray<Record<string, unknown>> {
    if (this.activeSession !== session || this.activeGeneration !== generation) return [];
    const header = session.sessionManager.getHeader();
    return [
      ...(header ? [header as unknown as Record<string, unknown>] : []),
      ...session.sessionManager.getEntries().map((entry) => entry as unknown as Record<string, unknown>)
    ];
  }
}
