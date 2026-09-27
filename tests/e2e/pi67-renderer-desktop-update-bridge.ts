import type { Page } from "@playwright/test";
import type { DesktopSystemBridge, DesktopUpdateState } from "@pi67/protocol";

export type MockDesktopUpdateBridge = Pick<DesktopSystemBridge,
  "getUpdateState" | "checkForUpdates" | "startUpdate" | "cancelUpdate" | "onUpdateStateChanged">;

const available = {
  channel: "unsigned-preview",
  currentVersion: "0.1.0-alpha.1",
  version: "0.1.0-alpha.2",
  artifactName: "Pi-67-Desktop-0.1.0-alpha.2-mac-arm64-unsigned-preview.zip",
  artifactBytes: 104_857_600,
  automaticChecks: true,
  checkedAt: "2026-08-03T08:00:00.000Z"
};

/** Installs update methods and window.__pi67UpdateTest; the primary bridge reads its external-open control. */
export async function installMockDesktopUpdateBridge(
  page: Page,
  options: { deferInitialUpdateState: boolean }
): Promise<void> {
  await page.addInitScript(({ deferInitialUpdateState, availableState }) => {
    const fixtureWindow = window as unknown as {
      __pi67SystemFixture?: { methods: Partial<DesktopSystemBridge> };
    };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    let updateState: Record<string, unknown> = {
      phase: "idle",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      automaticChecks: true
    };
    // The mock plays an untrusted wire: tests may emit states outside the contract to exercise
    // renderer validation, so values are cast only where they cross the typed bridge.
    const wireState = (state: Record<string, unknown>) => structuredClone(state) as DesktopUpdateState;
    const updateListeners = new Set<(state: DesktopUpdateState) => void>();
    let finishUpdate: ((state: DesktopUpdateState) => void) | undefined;
    let resolveInitialUpdateState: (() => void) | undefined;
    const initialUpdateStateGate = deferInitialUpdateState
      ? new Promise<void>((resolve) => { resolveInitialUpdateState = resolve; })
      : Promise.resolve();
    const publish = (state: Record<string, unknown>) => {
      updateState = structuredClone(state);
      for (const listener of updateListeners) listener(wireState(updateState));
    };
    const updateTest = {
      checks: 0,
      starts: 0,
      cancellations: 0,
      openedUrls: [] as string[],
      allowOpen: false,
      finishInitialRead() {
        resolveInitialUpdateState?.();
        resolveInitialUpdateState = undefined;
      },
      emit: publish
    };
    const bridge = {
      getUpdateState: async () => { await initialUpdateStateGate; return wireState(updateState); },
      checkForUpdates: async () => {
        updateTest.checks += 1;
        publish({ ...availableState, phase: "available" });
        return wireState(updateState);
      },
      startUpdate: async () => {
        updateTest.starts += 1;
        publish({ ...availableState, phase: "downloading", transferred: 52_428_800, percent: 50 });
        return new Promise<DesktopUpdateState>((resolve) => { finishUpdate = resolve; });
      },
      cancelUpdate: async () => {
        updateTest.cancellations += 1;
        publish({ ...availableState, phase: "available" });
        finishUpdate?.(wireState(updateState));
        finishUpdate = undefined;
        return wireState(updateState);
      },
      onUpdateStateChanged: (listener: (state: DesktopUpdateState) => void) => {
        updateListeners.add(listener);
        return () => { updateListeners.delete(listener); };
      }
    } satisfies MockDesktopUpdateBridge;
    Object.assign(systemFixture.methods, bridge);
    Object.defineProperty(window, "__pi67UpdateTest", { configurable: false, value: updateTest });
  }, { deferInitialUpdateState: options.deferInitialUpdateState, availableState: available });
}
