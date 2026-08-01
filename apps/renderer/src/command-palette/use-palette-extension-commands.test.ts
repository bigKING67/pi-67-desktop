import type { SlashCommandCatalogResult, SlashCommandDescriptor } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeCommands = vi.hoisted(() => ({
  list: vi.fn<() => Promise<SlashCommandCatalogResult>>()
}));

const hookRuntime = vi.hoisted(() => {
  const unset = Symbol("unset hook state");
  let state: unknown = unset;
  let dependencies: readonly unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  let revision = 0;

  const useState = <State,>(initial: State | (() => State)) => {
    if (state === unset) state = typeof initial === "function" ? (initial as () => State)() : initial;
    const setState = (next: State | ((current: State) => State)) => {
      const current = state as State;
      const resolved = typeof next === "function"
        ? (next as (value: State) => State)(current)
        : next;
      if (Object.is(current, resolved)) return;
      state = resolved;
      revision += 1;
    };
    return [state as State, setState] as const;
  };
  const useEffect = (effect: () => void | (() => void), nextDependencies?: readonly unknown[]) => {
    const changed = dependencies === undefined
      || nextDependencies === undefined
      || dependencies.length !== nextDependencies.length
      || dependencies.some((value, index) => !Object.is(value, nextDependencies[index]));
    if (!changed) return;
    cleanup?.();
    dependencies = nextDependencies ? [...nextDependencies] : undefined;
    cleanup = effect() ?? undefined;
  };

  return {
    useState,
    useEffect,
    reset() {
      cleanup?.();
      state = unset;
      dependencies = undefined;
      cleanup = undefined;
      revision = 0;
    },
    unmount() {
      cleanup?.();
      dependencies = undefined;
      cleanup = undefined;
    },
    get revision() {
      return revision;
    }
  };
});

vi.mock("react", () => ({
  useEffect: hookRuntime.useEffect,
  useState: hookRuntime.useState
}));

vi.mock("../operation/operation-controller.js", () => ({
  listRuntimeCommands: runtimeCommands.list
}));

import { MAX_EXTENSION_CANDIDATES } from "./command-palette-model.js";
import { usePaletteExtensionCommands } from "./use-palette-extension-commands.js";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function render(options: {
  open: boolean;
  connected: boolean;
  hostEpoch: number | undefined;
}) {
  return usePaletteExtensionCommands(options);
}

async function settlePromiseCallbacks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  hookRuntime.reset();
  runtimeCommands.list.mockReset();
});

describe("usePaletteExtensionCommands", () => {
  it("keeps disconnected and closed states non-authoritative without requesting commands", () => {
    expect(render({ open: false, connected: true, hostEpoch: 1 })).toEqual({
      status: "idle",
      commands: []
    });
    render({ open: true, connected: false, hostEpoch: undefined });
    expect(render({ open: true, connected: false, hostEpoch: undefined })).toEqual({
      status: "unavailable",
      commands: []
    });
    expect(runtimeCommands.list).not.toHaveBeenCalled();
  });

  it("fails explicitly instead of presenting a rejected request as an authoritative empty result", async () => {
    runtimeCommands.list.mockRejectedValueOnce(new Error("host unavailable"));

    expect(render({ open: true, connected: true, hostEpoch: 7 })).toEqual({
      status: "idle",
      commands: []
    });
    expect(render({ open: true, connected: true, hostEpoch: 7 })).toEqual({
      status: "loading",
      commands: []
    });
    await settlePromiseCallbacks();

    expect(render({ open: true, connected: true, hostEpoch: 7 })).toMatchObject({
      status: "failed",
      commands: [],
      error: expect.any(String)
    });
  });

  it("binds results to the current Host epoch and ignores an overlapping stale response", async () => {
    const stale = deferred<SlashCommandCatalogResult>();
    const current = deferred<SlashCommandCatalogResult>();
    runtimeCommands.list.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);

    render({ open: true, connected: true, hostEpoch: 10 });
    expect(render({ open: true, connected: true, hostEpoch: 10 }).status).toBe("loading");
    render({ open: true, connected: true, hostEpoch: 11 });
    expect(runtimeCommands.list).toHaveBeenCalledTimes(2);

    current.resolve(catalog([{ name: "current-command", source: "extension" }]));
    await settlePromiseCallbacks();
    expect(render({ open: true, connected: true, hostEpoch: 11 })).toEqual({
      status: "ready",
      commands: [{ name: "current-command", source: "extension" }]
    });

    stale.resolve(catalog([{ name: "stale-command", source: "extension" }]));
    await settlePromiseCallbacks();
    expect(render({ open: true, connected: true, hostEpoch: 11 })).toEqual({
      status: "ready",
      commands: [{ name: "current-command", source: "extension" }]
    });
  });

  it("prevents an in-flight request from updating state after effect cleanup", async () => {
    const pending = deferred<SlashCommandCatalogResult>();
    runtimeCommands.list.mockReturnValueOnce(pending.promise);

    render({ open: true, connected: true, hostEpoch: 22 });
    const revisionBeforeUnmount = hookRuntime.revision;
    hookRuntime.unmount();
    pending.resolve(catalog([{ name: "late-command", source: "extension" }]));
    await settlePromiseCallbacks();

    expect(hookRuntime.revision).toBe(revisionBeforeUnmount);
  });

  it("limits the normalized command catalog to the bounded candidate contract", async () => {
    const commands = Array.from(
      { length: MAX_EXTENSION_CANDIDATES + 25 },
      (_, index): SlashCommandDescriptor => ({ name: `command-${index}`, source: "extension" })
    );
    runtimeCommands.list.mockResolvedValueOnce(catalog(commands));

    render({ open: true, connected: true, hostEpoch: 30 });
    await settlePromiseCallbacks();
    const state = render({ open: true, connected: true, hostEpoch: 30 });

    expect(state.status).toBe("ready");
    expect(state.commands).toHaveLength(MAX_EXTENSION_CANDIDATES);
    expect(state.commands.at(-1)?.name).toBe(`command-${MAX_EXTENSION_CANDIDATES - 1}`);
  });
});

function catalog(items: SlashCommandDescriptor[]): SlashCommandCatalogResult {
  return { items, total: items.length, truncated: false };
}
