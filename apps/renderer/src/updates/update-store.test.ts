import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdatesNow,
  initializeUpdateProjection,
  useUpdateStore
} from "./update-store.js";

const idle = {
  phase: "idle",
  channel: "unsigned-preview",
  currentVersion: "0.1.0-alpha.1",
  automaticChecks: true
} as const;

const available = {
  phase: "available",
  channel: "unsigned-preview",
  currentVersion: "0.1.0-alpha.1",
  version: "0.1.0-alpha.2",
  releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
  automaticChecks: true
} as const;

describe("update store", () => {
  beforeEach(() => {
    useUpdateStore.setState(useUpdateStore.getInitialState(), true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an event that arrives before the initial state read", async () => {
    const initial = deferred<unknown>();
    const fixture = installBridge(initial.promise);
    const cleanup = initializeUpdateProjection();

    fixture.emit(available);
    initial.resolve(idle);
    await initial.promise;
    await Promise.resolve();

    expect(useUpdateStore.getState()).toMatchObject({
      initialized: true,
      update: available
    });
    cleanup();
  });

  it("recovers from an initial read failure when a later event succeeds", async () => {
    const fixture = installBridge(Promise.reject(new Error("Main unavailable")));
    const cleanup = initializeUpdateProjection();
    await Promise.resolve();
    await Promise.resolve();

    expect(useUpdateStore.getState()).toMatchObject({
      initialized: true,
      update: { phase: "error" }
    });

    fixture.emit(available);
    expect(useUpdateStore.getState()).toMatchObject({
      initialized: true,
      update: available
    });
    cleanup();
  });

  it("ignores the initial read and later events after cleanup", async () => {
    const initial = deferred<unknown>();
    const fixture = installBridge(initial.promise);
    const cleanup = initializeUpdateProjection();

    cleanup();
    fixture.emit(available);
    initial.resolve(idle);
    await initial.promise;
    await Promise.resolve();

    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState()).toMatchObject({
      initialized: false,
      update: { phase: "idle", currentVersion: "unknown", automaticChecks: false }
    });
  });

  it("preserves the known version and automatic-check mode when a manual check fails", async () => {
    installBridge(Promise.resolve(idle), Promise.reject(new Error("Network unavailable")));
    useUpdateStore.getState().install(idle);

    await expect(checkForUpdatesNow()).resolves.toMatchObject({
      phase: "error",
      currentVersion: idle.currentVersion,
      automaticChecks: true
    });
    expect(useUpdateStore.getState()).toMatchObject({
      initialized: true,
      update: {
        phase: "error",
        currentVersion: idle.currentVersion,
        automaticChecks: true
      }
    });
  });
});

function installBridge(initialState: Promise<unknown>, manualState = Promise.resolve(idle)) {
  let listener: ((state: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.stubGlobal("window", {
    pi67: {
      system: {
        getUpdateState: vi.fn(() => initialState),
        checkForUpdates: vi.fn(() => manualState),
        onUpdateStateChanged: vi.fn((next: (state: unknown) => void) => {
          listener = next;
          return unsubscribe;
        })
      }
    }
  });
  return {
    emit(value: unknown) {
      listener?.(value);
    },
    unsubscribe
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
