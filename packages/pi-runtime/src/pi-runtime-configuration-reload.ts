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
  refreshTimeoutMs?: number;
}

const DEFAULT_REFRESH_TIMEOUT_MS = 5_000;

export class PiRuntimeConfigurationReload {
  private reload: Promise<void> | undefined;
  private reloadAbort: AbortController | undefined;
  private pendingRevision: string | undefined;
  private appliedRevision: string | undefined;
  private invalidatedModel: { provider: string; id: string } | undefined;
  private selectionRequired = false;
  private disposed = false;

  constructor(private readonly options: PiRuntimeConfigurationReloadOptions) {}

  async request(revision: string): Promise<PiConfigurationReloadState> {
    if (this.disposed) return "not-loaded";
    if (revision === this.appliedRevision && !this.pendingRevision) return "applied";
    if (this.pendingRevision !== revision) this.reloadAbort?.abort();
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
    if (this.disposed) return;
    if (this.reload) return this.reload;
    const execute = async (): Promise<void> => {
      while (this.pendingRevision && !this.disposed) {
        const session = this.options.getSession();
        if (!session?.isIdle) return;
        const revision = this.pendingRevision;
        this.pendingRevision = undefined;
        const current = session.model;
        const target = current
          ? { provider: current.provider, id: current.id }
          : this.invalidatedModel;
        const controller = new AbortController();
        this.reloadAbort = controller;
        const timeout = setTimeout(
          () => controller.abort(),
          this.options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS
        );
        timeout.unref?.();
        try {
          const result = await session.modelRuntime.refresh({
            allowNetwork: false,
            signal: controller.signal
          });
          if (result.aborted) {
            if (this.disposed) return;
            if (this.pendingRevision !== undefined) continue;
            this.pendingRevision = revision;
            throw new RuntimeError(
              "RUNTIME_NOT_READY",
              "Pi model configuration refresh timed out.",
              { recoverable: true }
            );
          }
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
        } finally {
          clearTimeout(timeout);
          if (this.reloadAbort === controller) this.reloadAbort = undefined;
        }
      }
    };
    this.reload = execute().finally(() => {
      this.reload = undefined;
    });
    return this.reload;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.pendingRevision = undefined;
    this.reloadAbort?.abort();
    await this.reload?.catch(() => undefined);
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
