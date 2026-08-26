import {
  RuntimeError,
  type PlanImplementationRequestLineage,
  type SessionInteractionMode,
  type SessionSnapshot
} from "@pi67/domain";
import type { PiRuntimeSessionActions } from "./pi-runtime-session-actions.js";
import type { PiSdkRuntimeSessionLifecycle } from "./pi-sdk-runtime-session-lifecycle.js";
import type { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import { SessionSemanticTitleGenerator } from "./session-semantic-title.js";

export interface PiRuntimeConversationActionsOptions {
  sessionBindings: RuntimeSessionBindings;
  sessionLifecycle: PiSdkRuntimeSessionLifecycle;
  sessionActions: PiRuntimeSessionActions;
  persistProjection(): Promise<void>;
  assertWritable(): Promise<void>;
}

export class PiRuntimeConversationActions {
  private readonly semanticTitles: SessionSemanticTitleGenerator;

  constructor(private readonly options: PiRuntimeConversationActionsOptions) {
    this.semanticTitles = new SessionSemanticTitleGenerator({
      isCurrent: (session, generation) => (
        this.options.sessionBindings.session === session
        && this.options.sessionBindings.sessionGeneration === generation
      ),
      persistProjection: () => this.options.persistProjection()
    });
  }

  cancelSemanticTitle(): void {
    this.semanticTitles.cancel();
  }

  scheduleSemanticTitle(): void {
    const session = this.options.sessionBindings.session;
    if (!session) return;
    void this.semanticTitles.generate(
      session,
      this.options.sessionBindings.sessionGeneration,
      "automatic"
    ).catch(() => undefined);
  }

  async create(creationId: string): Promise<SessionSnapshot> {
    this.cancelSemanticTitle();
    return this.options.sessionLifecycle.create(creationId);
  }

  async open(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    this.cancelSemanticTitle();
    const snapshot = await this.options.sessionActions.open(path, cwdOverride);
    this.scheduleSemanticTitle();
    return snapshot;
  }

  async import(path: string): Promise<SessionSnapshot> {
    this.cancelSemanticTitle();
    const snapshot = await this.options.sessionActions.import(path);
    this.scheduleSemanticTitle();
    return snapshot;
  }

  async fork(entryId: string, position: "before" | "at"): Promise<SessionSnapshot> {
    this.cancelSemanticTitle();
    return this.options.sessionActions.fork(entryId, position);
  }

  async forkFrom(sourcePath: string, entryId: string): Promise<SessionSnapshot> {
    this.cancelSemanticTitle();
    return this.options.sessionActions.forkFrom(sourcePath, entryId);
  }

  async rollback(entryId: string, summarize: boolean): Promise<void> {
    this.cancelSemanticTitle();
    await this.options.sessionActions.rollback(entryId, summarize);
  }

  compact(instructions?: string): Promise<void> {
    return this.options.sessionActions.compact(instructions);
  }

  async setName(name?: string): Promise<void> {
    if (name?.trim()) this.cancelSemanticTitle();
    await this.options.sessionActions.setName(name);
  }

  async regenerateTitle(): Promise<void> {
    await this.options.assertWritable();
    const result = await this.semanticTitles.generate(
      this.options.sessionBindings.requireSession(),
      this.options.sessionBindings.sessionGeneration,
      "manual"
    );
    if (result.kind === "skipped") {
      throw new RuntimeError(
        "INVALID_PAYLOAD",
        "The active Pi Session does not have enough completed conversation context to generate a title.",
        { recoverable: true }
      );
    }
  }

  setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    return this.options.sessionActions.setInteractionMode(mode);
  }

  implementPlan(planId: string, lineage: PlanImplementationRequestLineage): Promise<void> {
    return this.options.sessionActions.implementPlan(planId, lineage);
  }
}
