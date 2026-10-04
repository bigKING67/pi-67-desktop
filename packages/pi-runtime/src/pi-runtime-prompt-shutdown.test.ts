import { afterEach, describe, expect, it, vi } from "vitest";
import { continueInterruptedTask } from "./interrupted-task-recovery.js";
import { PiRuntimePromptActions } from "./pi-runtime-prompt-actions.js";

vi.mock("./interrupted-task-recovery.js", () => ({
  continueInterruptedTask: vi.fn(), inspectInterruptedTask: vi.fn()
}));

afterEach(() => vi.clearAllMocks());

type Options = ConstructorParameters<typeof PiRuntimePromptActions>[0];
type Action = "submit" | "continue" | "command";

function fixture() {
  const started = Promise.withResolvers<void>();
  const completion = Promise.withResolvers<void>();
  const execute = vi.fn(() => { started.resolve(); return completion.promise; });
  const session = { isStreaming: false, prompt: execute, abort: vi.fn(async () => undefined) };
  vi.mocked(continueInterruptedTask).mockImplementation(execute);
  const upsertCurrent = vi.fn(async (): Promise<void> => undefined);
  const apply = vi.fn(async (): Promise<void> => undefined);
  const generateSemanticTitle = vi.fn();
  const actions = new PiRuntimePromptActions({
    assertWritable: async () => undefined,
    sessionBindings: { requireSession: () => session } as unknown as Options["sessionBindings"],
    sessionCatalog: { upsertCurrent } as unknown as Options["sessionCatalog"],
    configurationReload: { assertReady: async () => undefined, apply } as unknown as Options["configurationReload"],
    promptAttachments: { submit: execute } as unknown as Options["promptAttachments"],
    generateSemanticTitle
  });
  const run = (action: Action, signal?: AbortSignal) => {
    if (action === "submit") return actions.submit("fixture", undefined, signal);
    if (action === "continue") return actions.continueInterrupted("fixture-anchor", signal);
    return actions.invokeCommand("fixture");
  };
  return { actions, apply, completion, generateSemanticTitle, run, session, started, upsertCurrent };
}

describe.each<Action>(["submit", "continue", "command"])("%s shutdown projection boundary", (action) => {
  it("does not start disposable refreshes after shutdown, while still waiting for the active prompt", async () => {
    const f = fixture();
    let settled = false;
    const pending = f.run(action).finally(() => { settled = true; });
    await f.started.promise;
    f.actions.beginShutdown();
    f.actions.beginShutdown();
    await Promise.resolve();
    expect(settled).toBe(false);
    f.completion.resolve();
    await pending;
    expect(f.upsertCurrent).not.toHaveBeenCalled();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.generateSemanticTitle).not.toHaveBeenCalled();
  });

  it("waits for an already-started catalog update without starting configuration refresh afterward", async () => {
    const f = fixture();
    const catalogStarted = Promise.withResolvers<void>();
    const catalogFinished = Promise.withResolvers<void>();
    f.upsertCurrent.mockImplementation(() => { catalogStarted.resolve(); return catalogFinished.promise; });
    let settled = false;
    const pending = f.run(action).finally(() => { settled = true; });
    f.completion.resolve();
    await catalogStarted.promise;
    f.actions.beginShutdown();
    await Promise.resolve();
    expect(settled).toBe(false);
    catalogFinished.resolve();
    await pending;
    expect(f.upsertCurrent).toHaveBeenCalledOnce();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.generateSemanticTitle).not.toHaveBeenCalled();
  });

  it("does not detach an in-flight configuration refresh or restart semantic titles", async () => {
    const f = fixture();
    const configurationStarted = Promise.withResolvers<void>();
    const configurationFinished = Promise.withResolvers<void>();
    f.apply.mockImplementation(() => { configurationStarted.resolve(); return configurationFinished.promise; });
    let settled = false;
    const pending = f.run(action).finally(() => { settled = true; });
    f.completion.resolve();
    await configurationStarted.promise;
    f.actions.beginShutdown();
    await Promise.resolve();
    expect(settled).toBe(false);
    configurationFinished.resolve();
    await pending;
    expect(f.upsertCurrent).toHaveBeenCalledOnce();
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.generateSemanticTitle).not.toHaveBeenCalled();
  });
});

it.each<Action>(["submit", "continue"])("retains %s refreshes for ordinary user cancellation", async (action) => {
  const f = fixture();
  const controller = new AbortController();
  const pending = f.run(action, controller.signal);
  await f.started.promise;
  controller.abort();
  f.completion.resolve();
  await pending;
  expect(f.upsertCurrent).toHaveBeenCalledWith("session-updated");
  expect(f.apply).toHaveBeenCalledOnce();
  expect(f.generateSemanticTitle).toHaveBeenCalledTimes(action === "submit" ? 1 : 0);
});
