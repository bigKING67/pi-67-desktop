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
    const window = application()?.windows()[0];
    const surface = window ? await withTimeout(inspectRendererSurface(window), 10_000).catch(() => null) : null;
    await writeFile(join(directory, "failure.json"), `${JSON.stringify({
      stage: current, at: new Date().toISOString(),
      error: String(error?.stack ?? error).slice(0, 4_000), surface
    }, null, 2)}\n`);
    await writeFile(join(directory, "process-output.txt"), processOutput().slice(0, 8_192));
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
