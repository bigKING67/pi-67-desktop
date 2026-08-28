import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiModelCatalogRefreshStatus } from "@pi67/protocol";

type ModelCatalogProvider = ReturnType<ModelRuntime["getProviders"]>[number];

export interface PiModelCatalogRuntime {
  getProviders(): readonly ModelCatalogProvider[];
  hasConfiguredAuth(providerId: string): boolean;
  refresh(options: Parameters<ModelRuntime["refresh"]>[0]): ReturnType<ModelRuntime["refresh"]>;
}

export interface PiModelCatalogRefreshReceipt {
  status: PiModelCatalogRefreshStatus;
  providers: string[];
  failedProviders: string[];
}

interface ActiveRefresh {
  force: boolean;
  promise: Promise<PiModelCatalogRefreshReceipt>;
}

interface PiModelCatalogRefreshCoordinatorOptions {
  timeoutMs: number;
  createRuntime(signal: AbortSignal): Promise<PiModelCatalogRuntime>;
  isOffline?: () => boolean;
}

export class PiModelCatalogRefreshCoordinator {
  private active: ActiveRefresh | undefined;
  private activeAbort: AbortController | undefined;
  private cancellation = 0;
  private disposed = false;

  constructor(private readonly options: PiModelCatalogRefreshCoordinatorOptions) {}

  refresh(force: boolean): Promise<PiModelCatalogRefreshReceipt> {
    if (this.disposed) return Promise.reject(new Error("Pi model catalog refresh is disposed."));
    if (this.active) {
      if (!force || this.active.force) return this.active.promise;
      const cancellation = this.cancellation;
      return this.active.promise.then((receipt) => (
        cancellation === this.cancellation ? this.refresh(true) : receipt
      ));
    }
    const active: ActiveRefresh = {
      force,
      promise: this.execute(force).finally(() => {
        if (this.active === active) this.active = undefined;
      })
    };
    this.active = active;
    return active.promise;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancel();
    await this.active?.promise.catch(() => undefined);
  }

  cancel(): void {
    this.cancellation += 1;
    this.activeAbort?.abort();
  }

  private async execute(force: boolean): Promise<PiModelCatalogRefreshReceipt> {
    if ((this.options.isOffline ?? isPiOffline)()) {
      return { status: "offline", providers: [], failedProviders: [] };
    }
    const controller = new AbortController();
    this.activeAbort = controller;
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    timeout.unref?.();
    let providers: string[] = [];
    try {
      const runtime = await this.options.createRuntime(controller.signal);
      providers = runtime.getProviders()
        .filter((provider) => supportsCatalogRefresh(provider) && runtime.hasConfiguredAuth(provider.id))
        .map((provider) => provider.id);
      if (providers.length === 0) {
        return { status: "unconfigured", providers, failedProviders: [] };
      }
      const result = await runtime.refresh({
        allowNetwork: true,
        force,
        providers,
        signal: controller.signal
      });
      if (result.aborted) {
        return { status: "timed-out", providers, failedProviders: [] };
      }
      const failedProviders = [...result.errors.keys()].sort();
      return {
        status: failedProviders.length === 0 ? "current" : "partial",
        providers,
        failedProviders
      };
    } catch {
      return {
        status: controller.signal.aborted ? "timed-out" : "partial",
        providers,
        failedProviders: controller.signal.aborted ? [] : [...providers]
      };
    } finally {
      clearTimeout(timeout);
      if (this.activeAbort === controller) this.activeAbort = undefined;
    }
  }
}

function isPiOffline(): boolean {
  const value = process.env.PI_OFFLINE?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function supportsCatalogRefresh(provider: ModelCatalogProvider): boolean {
  return typeof Reflect.get(provider, "refreshModels") === "function";
}
