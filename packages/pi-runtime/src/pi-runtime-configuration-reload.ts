import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type { AgentEvent, PiConfigurationReloadState } from "@pi67/protocol";
import { sessionMetaChangedEvent } from "./incremental-events.js";
import { reloadDesktopSettings } from "./desktop-package-toolchain.js";
import {
  projectSessionControls,
  projectSessionModelCatalog
} from "./session-snapshot.js";

interface PiRuntimeConfigurationReloadOptions {
  getSession(): AgentSession | undefined;
  emit(event: AgentEvent): void;
}

export class PiRuntimeConfigurationReload {
  private reload: Promise<void> | undefined;
  private pendingRevision: string | undefined;
  private appliedRevision: string | undefined;
  private invalidatedModel: { provider: string; id: string } | undefined;
  private selectionRequired = false;

  constructor(private readonly options: PiRuntimeConfigurationReloadOptions) {}

  async request(revision: string): Promise<PiConfigurationReloadState> {
    if (revision === this.appliedRevision && !this.pendingRevision) return "applied";
    this.pendingRevision = revision;
    const session = this.options.getSession();
    if (!session) return "not-loaded";
    if (!session.isIdle) return "pending";
    await this.apply();
    return this.pendingRevision ? "pending" : "applied";
  }

  async assertReady(): Promise<void> {
    await this.apply();
    if (!this.selectionRequired) return;
    throw new RuntimeError(
      "MODEL_NOT_FOUND",
      "The current Pi model was removed from configuration. Select another model before continuing.",
      {
        recoverable: false,
        ...(this.invalidatedModel === undefined
          ? {}
          : {
              details: {
                provider: this.invalidatedModel.provider,
                modelId: this.invalidatedModel.id,
                selectionRequired: true
              }
            })
      }
    );
  }

  markModelSelected(): void {
    this.selectionRequired = false;
    this.invalidatedModel = undefined;
  }

  async apply(): Promise<void> {
    if (this.reload) return this.reload;
    const execute = async (): Promise<void> => {
      while (this.pendingRevision) {
        const session = this.options.getSession();
        if (!session?.isIdle) return;
        const revision = this.pendingRevision;
        this.pendingRevision = undefined;
        const current = session.model;
        const target = current
          ? { provider: current.provider, id: current.id }
          : this.invalidatedModel;
        try {
          await session.modelRuntime.reloadConfig();
          await reloadDesktopSettings(session.settingsManager);
          session.setScopedModels(session.scopedModels.flatMap((entry) => {
            const refreshed = session.modelRuntime.getModel(entry.model.provider, entry.model.id);
            return refreshed ? [{ ...entry, model: refreshed }] : [];
          }));
          if (target) this.refreshSelectedModel(session, target);
          this.appliedRevision = revision;
          this.options.emit(sessionMetaChangedEvent(session));
          this.options.emit({
            type: "model.catalog.changed",
            payload: {
              sessionId: session.sessionId,
              controls: projectSessionControls(session),
              modelCatalog: projectSessionModelCatalog(session)
            }
          });
        } catch (error) {
          this.pendingRevision ??= revision;
          throw error;
        }
      }
    };
    this.reload = execute().finally(() => {
      this.reload = undefined;
    });
    return this.reload;
  }

  private refreshSelectedModel(session: AgentSession, target: { provider: string; id: string }): void {
    const refreshed = session.modelRuntime.getModel(target.provider, target.id);
    if (refreshed) {
      session.agent.state.model = refreshed;
      this.selectionRequired = false;
      this.invalidatedModel = undefined;
      return;
    }
    session.agent.state.model = undefined as never;
    this.selectionRequired = true;
    this.invalidatedModel = target;
  }
}
