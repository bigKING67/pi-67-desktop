export {};

declare global {
  interface Window {
    pi67: {
      system: {
        getPlatformInfo(): Promise<{ platform: "win32" | "darwin"; architecture: "x64" | "arm64"; version: string }>;
        connectAgentHost(): Promise<void>;
        selectWorkspace(): Promise<string | undefined>;
        selectSessionFile(): Promise<string | undefined>;
        saveDiagnostics(content: string): Promise<string | undefined>;
        showNotification(title: string, body: string): Promise<void>;
        requestOpenExternal(url: string): Promise<boolean>;
        getUpdateState(): Promise<unknown>;
        checkForUpdates(): Promise<unknown>;
        onAgentHostFailed(listener: (state: { code: number; recoverable: boolean; attempt?: number }) => void): () => void;
      };
    };
  }
}
