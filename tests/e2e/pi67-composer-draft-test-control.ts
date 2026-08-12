import type { Page } from "@playwright/test";
import type { ComposerDraftPersistedState } from "../../packages/domain/src/index.js";

export async function installComposerDraftTestControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let failNextUpdate = false;
    let holdNextUpdate = false;
    let releaseHeldUpdate: (() => void) | undefined;
    let readState = (): ComposerDraftPersistedState => ({ version: 1, drafts: [] });
    const control = {
      pendingUpdates: 0,
      updates: 0,
      state: () => readState(),
      setStateReader(reader: () => ComposerDraftPersistedState) {
        readState = reader;
      },
      failNextUpdate() {
        failNextUpdate = true;
      },
      holdNextUpdate() {
        holdNextUpdate = true;
      },
      releaseHeldUpdate() {
        releaseHeldUpdate?.();
        releaseHeldUpdate = undefined;
      },
      async beforeUpdate() {
        control.updates += 1;
        if (holdNextUpdate) {
          holdNextUpdate = false;
          control.pendingUpdates += 1;
          await new Promise<void>((resolve) => {
            releaseHeldUpdate = () => {
              control.pendingUpdates -= 1;
              resolve();
            };
          });
        }
        if (!failNextUpdate) return;
        failNextUpdate = false;
        throw new Error("Mock Composer draft update failed on demand.");
      }
    };
    Object.defineProperty(window, "__pi67ComposerDraftTest", {
      configurable: false,
      value: control
    });
  });
}
