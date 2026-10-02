import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRendererSurface } from "./packaged-electron-smoke-scenarios.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** CI uploads `test-results/` on failure or cancellation; keep evidence there. */
const defaultEvidenceDirectory = join(repositoryRoot, "test-results/packaged-smoke");

/**
 * Bounded stages plus a whole-run watchdog for the packaged smoke. A hung
 * Playwright wait otherwise runs until the CI job is cancelled and leaves no
 * evidence. Evidence is synthetic-profile only: stage name, bounded error,
 * window screenshot, renderer surface summary, and the already-bounded process
 * output the smoke captures.
 */
export function createPackagedSmokeGuard({
  application, processOutput,
  deadlineMs = 15 * 60_000,
  directory = process.env.PI67_PACKAGED_FAILURE_EVIDENCE_DIR?.trim() || defaultEvidenceDirectory
}) {
  let current = "launch";
  let recorded = false;
  const record = async (error) => {
    if (recorded) return;
    recorded = true;
    await mkdir(directory, { recursive: true });
    const app = application();
    const window = app?.windows()[0];
    // Main answers even when a renderer is busy, so this separates a crashed or
    // missing window from a hung one when the renderer probes below time out.
    const mainWindows = app ? await withTimeout(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((item) => ({
      destroyed: item.isDestroyed(), visible: !item.isDestroyed() && item.isVisible(),
      crashed: !item.isDestroyed() && item.webContents.isCrashed(), loading: !item.isDestroyed() && item.webContents.isLoading(),
      unresponsive: !item.isDestroyed() && item.webContents.isWaitingForResponse?.()
    }))), 10_000).catch((reason) => ({ error: String(reason?.message ?? reason).slice(0, 200) })) : null;
    const surface = window ? await withTimeout(inspectRendererSurface(window), 10_000)
      .catch((reason) => ({ error: String(reason?.message ?? reason).slice(0, 200) })) : null;
    await writeFile(join(directory, "failure.json"), `${JSON.stringify({
      stage: current, at: new Date().toISOString(), playwrightWindows: app?.windows().length ?? 0,
      error: String(error?.stack ?? error).slice(0, 4_000), mainWindows, surface
    }, null, 2)}\n`);
    await writeFile(join(directory, "process-output.txt"), processOutput().slice(0, 8_192));
    // When Main itself stops answering, a native stack sample and the host's CPU
    // table separate a blocking Main operation from a starved runner.
    const mainPid = app?.process?.().pid;
    if (process.platform === "darwin" && mainPid) {
      await writeFile(join(directory, "main-sample.txt"), (await run("sample", [String(mainPid), "3", "-mayDie"], 20_000)).slice(0, 400_000));
    }
    await writeFile(join(directory, "processes.txt"), (await run("ps", ["-axo", "pid,ppid,%cpu,%mem,etime,comm", "-r"], 5_000))
      .split("\n").slice(0, 40).join("\n"));
    if (window) await window.screenshot({ path: join(directory, `${current}.png`), timeout: 10_000 }).catch(() => undefined);
    console.error(`Packaged smoke failure evidence (stage ${current}): ${directory}`);
  };
  const watchdog = setTimeout(() => {
    const error = new Error(`Packaged smoke exceeded ${deadlineMs} ms during stage "${current}".`);
    void record(error).finally(() => {
      console.error(error.message);
      try { application()?.process().kill("SIGKILL"); } catch { /* best effort before exit */ }
      process.exit(1);
    });
  }, deadlineMs);
  return {
    /** Run one named stage; a hang fails at its own bound instead of the job timeout. */
    async stage(name, operation, timeoutMs = 3 * 60_000) {
      current = name;
      const result = await withTimeout(operation(), timeoutMs, `Packaged smoke stage "${name}" exceeded ${timeoutMs} ms.`);
      current = `after:${name}`;
      return result;
    },
    fail: (error) => record(error).catch(() => undefined),
    stop: () => clearTimeout(watchdog)
  };
}

function withTimeout(promise, timeoutMs, message = `Timed out after ${timeoutMs} ms.`) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })])
    .finally(() => clearTimeout(timer));
}

function run(command, args, timeout) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve(`${stdout}${stderr}${error ? `\n[${command} ${error.code ?? error.signal ?? "failed"}]` : ""}`);
    });
  });
}
