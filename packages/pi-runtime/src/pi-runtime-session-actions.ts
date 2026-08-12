import type {
  PlanImplementationRequestLineage,
  SessionInteractionMode,
  SessionSnapshot
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { conversationChangedEvent, sessionMetaChangedEvent, usageChangedEvent } from "./incremental-events.js";
import type { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";
import type { RuntimeProjectionController } from "./runtime-projection-controller.js";
import type { RuntimeSessionBindings } from "./runtime-session-bindings.js";
import type { createRuntimeSessionCatalog } from "./runtime-session-catalog.js";
import type { RuntimeSessionTransitions } from "./runtime-session-transitions.js";

interface PiRuntimeSessionActionsOptions {
  sessionBindings: RuntimeSessionBindings;
  sessionTransitions: RuntimeSessionTransitions;
  sessionCatalog: ReturnType<typeof createRuntimeSessionCatalog>;
  configurationReload: PiRuntimeConfigurationReload;
  projections: RuntimeProjectionController;
  assertWritable: () => Promise<void>;
  cancelInteractiveRequests: () => void;
  dropStream: () => void;
  getSnapshot: () => SessionSnapshot;
  emit: (event: AgentEvent) => void;
}

export class PiRuntimeSessionActions {
  constructor(private readonly options: PiRuntimeSessionActionsOptions) {}

  open(path: string, cwdOverride?: string): Promise<SessionSnapshot> {
    return this.options.sessionBindings.runTransition(
      () => this.options.sessionTransitions.open(path, cwdOverride)
    );
  }

  import(path: string): Promise<SessionSnapshot> {
    return this.options.sessionBindings.runTransition(
      () => this.options.sessionTransitions.import(path)
    );
  }

  async fork(entryId: string, position: "before" | "at"): Promise<SessionSnapshot> {
    await this.options.assertWritable();
    return this.options.sessionBindings.runTransition(async () => {
      this.options.cancelInteractiveRequests();
      this.options.dropStream();
      const result = await this.options.sessionBindings.requireRuntime().fork(entryId, { position });
      if (result.cancelled) throw new Error("A Pi extension cancelled the session fork.");
      await this.options.sessionCatalog.upsertCurrent("session-created");
      await this.options.configurationReload.apply();
      return this.options.getSnapshot();
    });
  }

  forkFrom(sourcePath: string, entryId: string): Promise<SessionSnapshot> {
    return this.options.sessionBindings.runTransition(
      () => this.options.sessionTransitions.forkFrom(sourcePath, entryId)
    );
  }

  async rollback(entryId: string, summarize: boolean): Promise<void> {
    await this.options.assertWritable();
    const session = this.options.sessionBindings.requireSession();
    await session.navigateTree(entryId, { summarize });
    this.options.emit(conversationChangedEvent(session, "rolled-back"));
    this.options.emit({ type: "tree.changed", payload: { reason: "rollback" } });
    this.options.emit(usageChangedEvent(this.options.projections.getStats(session)));
  }

  async compact(instructions?: string): Promise<void> {
    await this.options.assertWritable();
    await this.options.configurationReload.assertReady();
    try {
      await this.options.sessionBindings.requireSession().compact(instructions);
    } finally {
      await this.options.configurationReload.apply();
    }
  }

  async setName(name?: string): Promise<void> {
    await this.options.assertWritable();
    const session = this.options.sessionBindings.requireSession();
    session.setSessionName(name?.trim() ?? "");
    await this.options.sessionCatalog.upsertCurrent("session-updated");
    this.options.emit(sessionMetaChangedEvent(session));
  }

  async setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    await this.options.assertWritable();
    this.options.sessionBindings.setInteractionMode(mode);
    await this.options.sessionCatalog.upsertCurrent("session-updated");
  }

  async implementPlan(planId: string, lineage: PlanImplementationRequestLineage): Promise<void> {
    await this.options.assertWritable();
    await this.options.configurationReload.assertReady();
    try {
      await this.options.sessionBindings.implementPlan(planId, lineage);
    } finally {
      await this.options.sessionCatalog.upsertCurrent("session-updated");
      await this.options.configurationReload.apply();
    }
  }
}
