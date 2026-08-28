import type { PiConfigurationService } from "@pi67/pi-runtime";
import type { AgentCommand, AgentCommandType, CommandResults } from "@pi67/protocol";
import type { HostEventChannel } from "./host-event-channel.js";
import { HostCommandError } from "./protocol-error.js";
import { mutationFingerprint } from "./workspace-mutation-fingerprint.js";

export type AppConfigurationCommandType =
  | "provider.configuration.get"
  | "provider.configuration.save"
  | "provider.configuration.remove"
  | "provider.credential.store"
  | "provider.credential.reveal"
  | "provider.credential.remove"
  | "model.default.set"
  | "vision.assistant.global.set"
  | "provider.configuration.reload"
  | "provider.modelCatalog.refresh";

type AppConfigurationCommand = AgentCommand<AppConfigurationCommandType>;
type AppConfigurationResult = CommandResults[AppConfigurationCommandType];
type AppConfigurationMutationType = Exclude<AppConfigurationCommandType,
  | "provider.configuration.get"
  | "provider.configuration.reload"
  | "provider.modelCatalog.refresh"
  | "provider.credential.reveal">;
type AppConfigurationMutation = AgentCommand<AppConfigurationMutationType>;

interface MutationRecord {
  fingerprint: string;
  promise: Promise<AppConfigurationResult>;
  settledAt?: number;
}

const MAX_LEDGER_ENTRIES = 32;
const LEDGER_RETENTION_MS = 5 * 60_000;

export class AppConfigurationCommandRouter {
  private readonly mutations = new Map<string, MutationRecord>();
  private readonly pending = new Set<Promise<AppConfigurationResult>>();
  private unsubscribe: (() => void) | undefined;
  private backgroundModelCatalogRefreshStarted = false;

  constructor(private readonly configuration: PiConfigurationService) {}

  bindEvents(events: HostEventChannel): void {
    this.unsubscribe?.();
    this.unsubscribe = this.configuration.subscribeGlobal((change) => {
      events.sendFor({ type: "provider.configuration.changed", payload: change }, {
        runtime: undefined,
        operations: undefined,
        context: { scope: "app" }
      });
    });
  }

  startBackgroundModelCatalogRefresh(): void {
    if (this.backgroundModelCatalogRefreshStarted) return;
    this.backgroundModelCatalogRefreshStarted = true;
    void this.track(this.configuration.refreshModelCatalogs(false)).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.configuration.cancelModelCatalogRefresh();
    await Promise.allSettled(this.pending);
  }

  dispatch(
    command: AppConfigurationCommand,
    idempotencyKey?: string
  ): Promise<AppConfigurationResult> {
    if (command.type === "provider.configuration.get") return this.configuration.getGlobal();
    if (command.type === "provider.configuration.reload") return this.configuration.reloadGlobal();
    if (command.type === "provider.modelCatalog.refresh") {
      return this.track(this.configuration.refreshModelCatalogs(true));
    }
    if (command.type === "provider.credential.reveal") {
      return this.configuration.revealGlobalCredential(
        command.payload.expectedRevision,
        command.payload.provider
      );
    }
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe App configuration mutations require an idempotency key.",
        false
      ));
    }
    return this.runMutation(idempotencyKey, command as AppConfigurationMutation);
  }

  private runMutation(
    idempotencyKey: string,
    command: AppConfigurationMutation
  ): Promise<AppConfigurationResult> {
    this.prune();
    const fingerprint = mutationFingerprint(command);
    const existing = this.mutations.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different App configuration mutation.",
          false
        );
      }
      return existing.promise;
    }
    if (this.mutations.size >= MAX_LEDGER_ENTRIES) {
      const settled = [...this.mutations.entries()].find(([, record]) => record.settledAt !== undefined);
      if (!settled) {
        throw new HostCommandError(
          "RESOURCE_LIMIT_EXCEEDED",
          "Too many App configuration mutations are pending.",
          true
        );
      }
      this.mutations.delete(settled[0]);
    }
    const promise = this.execute(command);
    const record: MutationRecord = { fingerprint, promise };
    this.mutations.set(idempotencyKey, record);
    this.pending.add(promise);
    void promise.finally(() => {
      record.settledAt = Date.now();
      this.pending.delete(promise);
    }).catch(() => undefined);
    return promise;
  }

  private track(promise: Promise<AppConfigurationResult>): Promise<AppConfigurationResult> {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise)).catch(() => undefined);
    return promise;
  }

  private execute(command: AppConfigurationMutation): Promise<AppConfigurationResult> {
    switch (command.type) {
      case "provider.configuration.save":
        return this.configuration.saveGlobalProvider(
          command.payload.expectedRevision,
          command.payload.provider
        );
      case "provider.configuration.remove":
        return this.configuration.removeGlobalProvider(
          command.payload.expectedRevision,
          command.payload.provider
        );
      case "provider.credential.store":
        return this.configuration.storeGlobalCredential(
          command.payload.expectedRevision,
          command.payload.provider,
          command.payload.apiKey
        );
      case "provider.credential.remove":
        return this.configuration.removeGlobalCredential(
          command.payload.expectedRevision,
          command.payload.provider
        );
      case "model.default.set": {
        if (command.payload.scope !== "global") {
          return Promise.reject(new HostCommandError(
            "INVALID_PAYLOAD",
            "App authority can only update the global Pi default model.",
            false
          ));
        }
        const { provider, model } = command.payload;
        if ((provider === undefined) !== (model === undefined)) {
          return Promise.reject(new HostCommandError(
            "INVALID_PAYLOAD",
            "A Pi default model requires both Provider and model identifiers.",
            false
          ));
        }
        return this.configuration.setGlobalDefaultModel(
          command.payload.expectedRevision,
          provider === undefined || model === undefined ? undefined : { provider, model }
        );
      }
      case "vision.assistant.global.set": {
        const { provider, model } = command.payload;
        if ((provider === undefined) !== (model === undefined)) {
          return Promise.reject(new HostCommandError(
            "INVALID_PAYLOAD",
            "A Pi visual-assistance model requires both Provider and model identifiers.",
            false
          ));
        }
        return this.configuration.setGlobalVisionAssistant(
          command.payload.expectedRevision,
          provider === undefined || model === undefined ? undefined : { provider, model }
        );
      }
    }
  }

  private prune(): void {
    const cutoff = Date.now() - LEDGER_RETENTION_MS;
    for (const [key, record] of this.mutations) {
      if ((record.settledAt ?? Number.POSITIVE_INFINITY) <= cutoff) this.mutations.delete(key);
    }
  }
}

export function isAppConfigurationCommand(type: AgentCommandType): type is AppConfigurationCommandType {
  return type === "provider.configuration.get"
    || type === "provider.configuration.save"
    || type === "provider.configuration.remove"
    || type === "provider.credential.store"
    || type === "provider.credential.reveal"
    || type === "provider.credential.remove"
    || type === "model.default.set"
    || type === "vision.assistant.global.set"
    || type === "provider.configuration.reload"
    || type === "provider.modelCatalog.refresh";
}
