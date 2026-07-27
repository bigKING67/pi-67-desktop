import { readFile, writeFile } from "node:fs/promises";

const POLL_INTERVAL_MS = 50;
const CONTROLLED_PROVIDER_ID = "pi67-controlled";
const CONTROLLED_MODEL_ID = "hold-open";
export const CONTROLLED_MODEL_VALUE = `${CONTROLLED_PROVIDER_ID}/${CONTROLLED_MODEL_ID}`;
export const CONTROLLED_PROMPT_TEXT = "Keep the controlled Pi runtime active.";

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
    import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

    export default function controlledShutdownFixture(pi) {
      let child;
      const startChild = () => {
        if (child && child.exitCode === null && child.signalCode === null) return child;
        child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
          stdio: "ignore",
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        });
        writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
        return child;
      };
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
          const activeChild = startChild();
          await new Promise((resolve) => activeChild.once("exit", resolve));
        }
      });
      pi.registerProvider(${JSON.stringify(CONTROLLED_PROVIDER_ID)}, {
        name: "Pi-67 Controlled Runtime",
        baseUrl: "https://pi67.invalid",
        apiKey: "pi67-controlled-runtime",
        api: "openai-responses",
        models: [{
          id: ${JSON.stringify(CONTROLLED_MODEL_ID)},
          name: "Controlled Runtime",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 256
        }],
        streamSimple: (model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          const output = {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
            stopReason: "stop",
            timestamp: Date.now()
          };
          const activeChild = startChild();
          let settled = false;
          const settle = (reason) => {
            if (settled) return;
            settled = true;
            output.stopReason = reason;
            if (reason === "aborted") {
              stream.push({ type: "error", reason, error: output });
            } else {
              stream.push({ type: "done", reason, message: output });
            }
            stream.end();
          };
          stream.push({ type: "start", partial: output });
          options?.signal?.addEventListener("abort", () => {
            stopChild();
            settle("aborted");
          }, { once: true });
          activeChild.once("exit", () => settle(options?.signal?.aborted ? "aborted" : "stop"));
          return stream;
        }
      });
      pi.on("session_start", async (_event, ctx) => {
        const model = ctx.modelRegistry.find(
          ${JSON.stringify(CONTROLLED_PROVIDER_ID)},
          ${JSON.stringify(CONTROLLED_MODEL_ID)}
        );
        if (model) await pi.setModel(model);
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
