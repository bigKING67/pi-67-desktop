import type { Page } from "@playwright/test";
import type {
  DesktopSystemBridge,
  ShutdownCheckpointResponse
} from "@pi67/protocol";

export type MockDesktopShutdownBridge = Pick<DesktopSystemBridge,
  | "completeShutdownCheckpoint"
  | "onShutdownCheckpointRequested"
>;

export async function installMockDesktopShutdownBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type SystemFixtureRegistry = { methods: Partial<DesktopSystemBridge> };
    const fixtureWindow = window as unknown as { __pi67SystemFixture?: SystemFixtureRegistry };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    let listener: ((requestId: string) => void) | undefined;
    const testControl = {
      acknowledgements: [] as ShutdownCheckpointResponse[],
      request(requestId: string) {
        listener?.(requestId);
      }
    };
    const shutdownBridge = {
      completeShutdownCheckpoint: async (response: ShutdownCheckpointResponse) => {
        testControl.acknowledgements.push(structuredClone(response));
        return true;
      },
      onShutdownCheckpointRequested: (nextListener: (requestId: string) => void) => {
        listener = nextListener;
        return () => {
          if (listener === nextListener) listener = undefined;
        };
      }
    } satisfies MockDesktopShutdownBridge;
    Object.assign(systemFixture.methods, shutdownBridge);
    Object.defineProperty(window, "__pi67ShutdownCheckpointTest", {
      configurable: false,
      value: testControl
    });
  });
}
