// Test-only, Main-owned evidence: no page bodies, URLs, paths or process output.
export async function observeRecoveryBootstrap(application) {
  await application.evaluate(({ app, BrowserWindow }) => {
    const state = { records: [], dropped: 0 };
    const startedAt = performance.now();
    globalThis.__pi67RecoveryBootstrap = state;
    const record = (windowId, event, fields = {}) => {
      if (state.records.length >= 32) { state.dropped += 1; return; }
      state.records.push({ windowId, event, elapsedMs: Math.round(performance.now() - startedAt), ...fields });
    };
    const observe = window => {
      const id = window.id;
      record(id, "observed");
      for (const event of ["dom-ready", "did-finish-load", "did-start-loading", "did-stop-loading"]) {
        window.webContents.on(event, () => record(id, event));
      }
      window.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
        record(id, "did-fail-load", { errorCode, isMainFrame });
      });
      window.webContents.on("render-process-gone", (_event, details) => {
        record(id, "render-process-gone", { exitCode: details.exitCode });
      });
    };
    for (const window of BrowserWindow.getAllWindows()) observe(window);
    app.on("browser-window-created", (_event, window) => observe(window));
  });
}

export async function readRecoveryBootstrap(application, page) {
  let timer;
  try {
    return await Promise.race([
      application.evaluate(({ BrowserWindow }) => ({
        ...(globalThis.__pi67RecoveryBootstrap ?? { records: [], dropped: 0 }),
        windows: BrowserWindow.getAllWindows().map(window => {
          const contents = window.webContents;
          const url = contents.getURL();
          return { windowId: window.id, rendererPid: contents.getOSProcessId(),
            document: url === "app://pi67/index.html" ? "app" : url === "about:blank" || url === "" ? "blank" : "other",
            loading: contents.isLoading(), mainFrameLoading: contents.isLoadingMainFrame(),
            crashed: contents.isCrashed(), visible: window.isVisible() };
        })
      })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("probe deadline")), 2_000); })
    ]);
  } catch {
    return { unavailable: true, pageClosed: page?.isClosed() ?? null };
  } finally { clearTimeout(timer); }
}

export async function readRecoveryProtocolEvidence(page) {
  let timer;
  try {
    return await Promise.race([
      page?.evaluate(() => globalThis.__pi67RecoveryProtocol) ?? Promise.resolve({ unavailable: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("probe deadline")), 2_000); })
    ]);
  } catch {
    return { unavailable: true };
  } finally { clearTimeout(timer); }
}
