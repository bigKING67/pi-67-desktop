import type { Page } from "@playwright/test";

export async function installMockDesktopBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "0.1.0-alpha.1" }),
          connectAgentHost: async () => undefined,
          selectWorkspace: async () => "/Users/test/Projects/pi-demo",
          selectSessionFile: async () => "/Users/test/.pi/agent/sessions/demo.jsonl",
          saveDiagnostics: async () => "/tmp/pi67-diagnostics.json",
          showNotification: async () => undefined,
          requestOpenExternal: async (url: string) => {
            const testWindow = window as unknown as {
              __pi67UpdateTest: { checks: number; openedUrls: string[]; allowOpen: boolean };
            };
            testWindow.__pi67UpdateTest.openedUrls.push(url);
            return testWindow.__pi67UpdateTest.allowOpen;
          },
          getUpdateState: async () => ({
            phase: "idle",
            channel: "unsigned-preview",
            currentVersion: "0.1.0-alpha.1"
          }),
          checkForUpdates: async () => {
            const testWindow = window as unknown as { __pi67UpdateTest: { checks: number } };
            testWindow.__pi67UpdateTest.checks += 1;
            return {
              phase: "available",
              channel: "unsigned-preview",
              currentVersion: "0.1.0-alpha.1",
              version: "0.1.0-alpha.2",
              releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
              publishedAt: "2026-07-23T06:00:00.000Z"
            };
          },
          onAgentHostFailed: () => () => undefined,
          onPowerResume: () => () => undefined
        }
      }
    });
    Object.defineProperty(window, "__pi67UpdateTest", {
      configurable: false,
      value: { checks: 0, openedUrls: [], allowOpen: false }
    });
  });
}
