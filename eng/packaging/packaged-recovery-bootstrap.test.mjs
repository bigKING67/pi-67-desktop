import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { observeRecoveryBootstrap, readRecoveryBootstrap, readRecoveryProtocolEvidence } from "./packaged-recovery-bootstrap.mjs";

afterEach(() => {
  delete globalThis.__pi67RecoveryBootstrap;
  vi.useRealTimers();
});

function fixture(url = "app://pi67/index.html") {
  const app = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => url, getOSProcessId: () => 123,
    isLoading: () => true, isLoadingMainFrame: () => true, isCrashed: () => false
  });
  const windows = [{ id: 1, webContents: contents, isVisible: () => false }];
  const application = { evaluate: callback => Promise.resolve(callback({
    app, BrowserWindow: { getAllWindows: () => windows }
  })) };
  return { app, contents, windows, application };
}

it("captures native loading failures without URLs or free-text error payloads", async () => {
  const { application, contents } = fixture("file:///private/profile?token=synthetic-secret");
  await observeRecoveryBootstrap(application);
  contents.emit("did-fail-load", {}, -6, "synthetic-secret", "https://private.invalid", true);
  contents.emit("render-process-gone", {}, { exitCode: 9, reason: "synthetic-secret" });
  const result = await readRecoveryBootstrap(application);
  expect(result.records).toEqual([
    { windowId: 1, event: "observed", elapsedMs: expect.any(Number) },
    { windowId: 1, event: "did-fail-load", elapsedMs: expect.any(Number), errorCode: -6, isMainFrame: true },
    { windowId: 1, event: "render-process-gone", elapsedMs: expect.any(Number), exitCode: 9 }
  ]);
  expect(result.windows).toEqual([{
    windowId: 1, rendererPid: 123, document: "other", loading: true,
    mainFrameLoading: true, crashed: false, visible: false
  }]);
  expect(JSON.stringify(result)).not.toMatch(/private|secret|token/u);
});

it("observes windows created after attachment and bounds retained event records", async () => {
  const { application, app, contents, windows } = fixture();
  windows.length = 0;
  await observeRecoveryBootstrap(application);
  const window = { id: 2, webContents: contents, isVisible: () => false };
  windows.push(window);
  app.emit("browser-window-created", {}, window);
  for (let i = 0; i < 40; i++) contents.emit("dom-ready");
  const result = await readRecoveryBootstrap(application);
  expect(result.records).toHaveLength(32);
  expect(result.records[0]).toMatchObject({ windowId: 2, event: "observed" });
  expect(result.dropped).toBe(9);
  expect(result.windows[0].document).toBe("app");
});

it.each(["", "about:blank"])("distinguishes an unloaded document: %j", async url => {
  const result = await readRecoveryBootstrap(fixture(url).application);
  expect(result.windows[0].document).toBe("blank");
});

it("bounds a hung Main probe and releases its deadline after a successful read", async () => {
  vi.useFakeTimers();
  const pending = readRecoveryBootstrap({ evaluate: () => new Promise(() => {}) }, { isClosed: () => false });
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(pending).resolves.toEqual({ unavailable: true, pageClosed: false });
  await expect(readRecoveryBootstrap(fixture().application)).resolves.toMatchObject({ records: [] });
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves failure reporting after the application has disconnected", async () => {
  const application = { evaluate: () => Promise.reject(new Error("disconnected")) };
  await expect(readRecoveryBootstrap(application, { isClosed: () => true }))
    .resolves.toEqual({ unavailable: true, pageClosed: true });
});

it("lets cleanup continue after a hung Renderer read while preserving the original failure", async () => {
  vi.useFakeTimers();
  const original = new Error("DOM deadline");
  const cleanup = vi.fn();
  let evidence;
  const failingRun = async () => {
    try { throw original; }
    finally {
      evidence = await readRecoveryProtocolEvidence({ evaluate: () => new Promise(() => {}) });
      cleanup();
    }
  };
  const assertion = expect(failingRun()).rejects.toBe(original);
  await vi.advanceTimersByTimeAsync(2_000);
  await assertion;
  expect(evidence).toEqual({ unavailable: true });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("retains available protocol records and tolerates a disconnected or missing page", async () => {
  const records = [{ kind: "event", type: "runtime.ready" }];
  await expect(readRecoveryProtocolEvidence({ evaluate: () => Promise.resolve(records) })).resolves.toBe(records);
  await expect(readRecoveryProtocolEvidence({ evaluate: () => Promise.reject(new Error("disconnected")) }))
    .resolves.toEqual({ unavailable: true });
  await expect(readRecoveryProtocolEvidence()).resolves.toEqual({ unavailable: true });
});
