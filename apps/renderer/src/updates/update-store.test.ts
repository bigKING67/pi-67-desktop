import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelUpdateNow,
  checkForUpdatesNow,
  initializeUpdateProjection,
  startUpdateNow,
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
  artifactName: "Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe",
  artifactBytes: 1_000,
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

  it("projects start and cancellation states from the narrow update bridge", async () => {
    const fixture = installBridge(Promise.resolve(idle), Promise.resolve(available), {
      ...available,
      phase: "downloading",
      transferred: 500,
      percent: 50
    }, available);
    useUpdateStore.getState().install(available);

    await expect(startUpdateNow()).resolves.toMatchObject({ phase: "downloading", percent: 50 });
    await expect(cancelUpdateNow()).resolves.toMatchObject({ phase: "available" });
    expect(fixture.startUpdate).toHaveBeenCalledOnce();
    expect(fixture.cancelUpdate).toHaveBeenCalledOnce();
  });
});

function installBridge(
  initialState: Promise<unknown>,
  manualState: Promise<unknown> = Promise.resolve(idle),
  startedState: unknown = available,
  cancelledState: unknown = available
) {
  let listener: ((state: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const startUpdate = vi.fn(async () => startedState);
  const cancelUpdate = vi.fn(async () => cancelledState);
  vi.stubGlobal("window", {
    pi67: {
      system: {
        getUpdateState: vi.fn(() => initialState),
        checkForUpdates: vi.fn(() => manualState),
        startUpdate,
        cancelUpdate,
        onUpdateStateChanged: vi.fn((next: (state: unknown) => void) => {
          listener = next;
          return unsubscribe;
        })
      }
    }
  });
  return {
    startUpdate,
    cancelUpdate,
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
