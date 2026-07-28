import type {
  AgentRuntime,
  PiSdkRuntimeOptions,
  RuntimeCredentialOverrideStore
} from "@pi67/pi-runtime";

export interface HostSdkVersionLoaderOptions {
  runtimeLoader(options?: PiSdkRuntimeOptions): Promise<AgentRuntime>;
  runtimeCredentialOverrides: RuntimeCredentialOverrideStore;
  usesCompatibilityRuntime: boolean;
  loadCompatibilityRuntime(): Promise<AgentRuntime>;
  sdkVersionLoader?: () => Promise<string>;
}

export class HostSdkVersionLoader {
  private sdkVersion: string | undefined;
  private sdkVersionLoad: Promise<string> | undefined;

  constructor(private readonly options: HostSdkVersionLoaderOptions) {}

  load(): Promise<string> {
    if (this.sdkVersion !== undefined) return Promise.resolve(this.sdkVersion);
    this.sdkVersionLoad ??= this.loadUncached().then(
      (sdkVersion) => {
        this.sdkVersion = sdkVersion;
        return sdkVersion;
      },
      (error: unknown) => {
        this.sdkVersionLoad = undefined;
        throw error;
      }
    );
    return this.sdkVersionLoad;
  }

  private async loadUncached(): Promise<string> {
    if (this.options.sdkVersionLoader) return this.options.sdkVersionLoader();
    if (this.options.usesCompatibilityRuntime) {
      return (await this.options.loadCompatibilityRuntime()).getSdkVersion();
    }
    const runtime = await this.options.runtimeLoader({
      runtimeCredentialOverrides: this.options.runtimeCredentialOverrides
    });
    try {
      return runtime.getSdkVersion();
    } finally {
      await runtime.dispose();
    }
  }
}
