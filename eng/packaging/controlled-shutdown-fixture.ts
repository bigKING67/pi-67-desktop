import { readFile, writeFile } from "node:fs/promises";

const POLL_INTERVAL_MS = 50;

interface ControlledShutdownExtensionOptions {
  extensionPath: string;
  childPidPath: string;
  lifecyclePath: string;
}

export async function writeControlledShutdownExtension({
  extensionPath,
  childPidPath,
  lifecyclePath
}: ControlledShutdownExtensionOptions): Promise<void> {
  await writeFile(extensionPath, `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { spawn } from "node:child_process";

    export default function controlledShutdownFixture(pi) {
      let child;
      const stopChild = () => {
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
      };
      pi.on("session_shutdown", (event) => {
        appendFileSync(${JSON.stringify(lifecyclePath)}, "shutdown:" + event.reason + "\\n");
        stopChild();
      });
      pi.registerCommand("hold-open", {
        description: "Start a controlled child process until Pi shuts down",
        handler: async () => {
          child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
            stdio: "ignore",
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
          });
          writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
          await new Promise((resolve) => child.once("exit", resolve));
        }
      });
    }
  `, "utf8");
}

export async function resetControlledShutdownLifecycle(path: string): Promise<void> {
  await writeFile(path, "", "utf8");
}

export async function assertSingleShutdownQuitLifecycle(path: string, label: string): Promise<void> {
  const entries = (await readFile(path, "utf8"))
    .split(/\r?\n/u)
    .filter((entry) => entry.length > 0);
  if (entries.length !== 1 || entries[0] !== "shutdown:quit") {
    const observedEntries = entries.slice(0, 4);
    throw new Error(
      `${label} expected exactly one session_shutdown(reason=quit) lifecycle entry; `
      + `observed ${entries.length}: ${JSON.stringify(observedEntries)}`
    );
  }
}

export async function readPositiveProcessId(path: string, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const value = Number((await readFile(path, "utf8").catch(() => "0")).trim());
    if (Number.isSafeInteger(value) && value > 0) return value;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for the controlled child process.");
}

export async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isProcessAlive(pid)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Process ${pid} remained alive after ${timeoutMs}ms.`);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
