const PREFIX = "Windows UI shutdown stage: ";
const STAGES = new Set([
  "before-quit", "window-close", "window-closed", "webcontents-destroyed",
  "will-prevent-unload", "will-quit", "quit", "process-exit"
]);
const MAX_RECORDS = 16;

// Installs passive observers only in the verifier's isolated application.
// Main's own clock separates Electron teardown from a late driver-side PID poll.
export async function observeWindowsUiShutdown(application) {
  await application.evaluate(({ app, BrowserWindow }, { prefix, maximum }) => {
    let startedAt;
    let count = 0;
    const record = (stage) => {
      if (startedAt === undefined || count >= maximum) return;
      try {
        process.stderr.write(`${prefix}${JSON.stringify({
          stage, sequence: ++count, elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10
        })}\n`);
      } catch {
        // A closed diagnostic stream must not change the application's exit.
      }
    };
    app.on("before-quit", () => {
      startedAt ??= performance.now();
      record("before-quit");
    });
    for (const window of BrowserWindow.getAllWindows()) {
      window.on("close", () => record("window-close"));
      window.once("closed", () => record("window-closed"));
      window.webContents.once("destroyed", () => record("webcontents-destroyed"));
      window.webContents.on("will-prevent-unload", () => record("will-prevent-unload"));
    }
    app.on("will-quit", () => record("will-quit"));
    app.on("quit", () => record("quit"));
    process.once("exit", () => record("process-exit"));
  }, { prefix: PREFIX, maximum: MAX_RECORDS });
}

export function parseWindowsUiShutdownObservations(output) {
  const records = [];
  for (const line of output.split(/\r?\n/u)) {
    if (records.length >= MAX_RECORDS) break;
    const start = line.indexOf(PREFIX);
    if (start < 0) continue;
    try {
      const value = JSON.parse(line.slice(start + PREFIX.length));
      if (!STAGES.has(value.stage) || !Number.isSafeInteger(value.sequence)
        || value.sequence < 1 || value.sequence > MAX_RECORDS
        || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) continue;
      records.push({ stage: value.stage, sequence: value.sequence, elapsedMs: value.elapsedMs });
    } catch {
      // Partial stderr lines cannot establish a completed lifecycle stage.
    }
  }
  return records;
}
