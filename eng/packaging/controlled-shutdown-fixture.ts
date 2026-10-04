import { readFile, writeFile } from "node:fs/promises";

const POLL_INTERVAL_MS = 50;
const CONTROLLED_PROVIDER_ID = "pi67-controlled";
const CONTROLLED_MODEL_ID = "hold-open";
export const CONTROLLED_MODEL_VALUE = `${CONTROLLED_PROVIDER_ID}/${CONTROLLED_MODEL_ID}`;
export const CONTROLLED_MODEL_LABEL = "Controlled Runtime";
export const CONTROLLED_PROMPT_TEXT = "Keep the controlled Pi runtime active.";
export const NATIVE_MCP_PROMPT_TEXT = "Run the packaged native MCP smoke echo exactly once.";

interface ControlledShutdownExtensionOptions {
  extensionPath: string;
  childPidPath: string;
  lifecyclePath: string;
  /** Optional bounded synthetic-process observations; never records model input. */
  observationPath?: string;
  /** Optional isolated packaged proof; records only mode flags and Tool names. */
  teamKnowledgeEvidencePath?: string;
  /** Optional isolated native-MCP proof; never records prompts or raw Tool payloads. */
  nativeMcpEvidencePath?: string;
}

interface ShutdownLifecycleExtensionOptions {
  extensionPath: string;
  lifecyclePath: string;
}

export async function writeShutdownLifecycleExtension({
  extensionPath,
  lifecyclePath
}: ShutdownLifecycleExtensionOptions): Promise<void> {
  await writeFile(extensionPath, `
    import { appendFileSync } from "node:fs";

    export default function shutdownLifecycleFixture(pi) {
      pi.on("session_shutdown", (event) => {
        appendFileSync(${JSON.stringify(lifecyclePath)}, "shutdown:" + event.reason + "\\n");
      });
    }
  `, "utf8");
}

export async function writeControlledShutdownExtension({
  extensionPath,
  childPidPath,
  lifecyclePath,
  observationPath,
  teamKnowledgeEvidencePath,
  nativeMcpEvidencePath
}: ControlledShutdownExtensionOptions): Promise<void> {
  await writeFile(extensionPath, `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { spawn } from "node:child_process";
    import { createAssistantMessageEventStream, getCurrentTools } from "@earendil-works/pi-ai";

    export default function controlledShutdownFixture(pi) {
      let observationCount = 0;
      const observe = (stage, detail = {}) => {
        ${observationPath ? `if (observationCount++ >= 64) return;
        try {
          appendFileSync(${JSON.stringify(observationPath)}, JSON.stringify({ stage, ...detail }) + "\\n");
        } catch {
          observationCount = 64;
          console.warn("[controlled-fixture] observations unavailable");
        }` : ""}
      };
      observe("extension-loaded");
      let child;
      let nativeToolCallObserved = false;
      let nativeModelSelected = false;
      let nativeResult;
      const nativeToolName = "mcp__packaged_native__echo";
      const nativePrompt = ${JSON.stringify(NATIVE_MCP_PROMPT_TEXT)};
      const nativeProbeRequested = (messages) => {
        const latestUser = [...messages].reverse().find((message) => message.role === "user");
        return JSON.stringify(latestUser?.content).includes(nativePrompt);
      };
      const writeNativeEvidence = () => {
        ${nativeMcpEvidencePath ? `const tool = pi.getAllTools().find((candidate) => candidate.name === nativeToolName);
        writeFileSync(${JSON.stringify(nativeMcpEvidencePath)}, JSON.stringify({
          discoveredTool: tool?.name,
          source: tool?.sourceInfo?.source,
          sourcePath: tool?.sourceInfo?.path,
          sourceScope: tool?.sourceInfo?.scope,
          sourceOrigin: tool?.sourceInfo?.origin,
          legacyMcpProxyPresent: pi.getAllTools().some((candidate) => candidate.name === "mcp"),
          toolCallObserved: nativeToolCallObserved,
          modelSelected: nativeModelSelected,
          resultObserved: nativeResult !== undefined,
          resultSucceeded: nativeResult?.isError === false && nativeResult.content.some((block) => (
            block.type === "text" && block.text === "PACKAGED_NATIVE_MCP_OK"
          )),
          ...(nativeResult?.isError ? { syntheticToolError: JSON.stringify(nativeResult.content).slice(0, 512) } : {})
        }), { mode: 0o600 });` : ""}
      };
      const startChild = () => {
        if (child && child.exitCode === null && child.signalCode === null) return child;
        child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
          stdio: "ignore",
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        });
        observe("child-created", { pid: child.pid ?? null });
        child.once("spawn", () => observe("child-spawned"));
        child.once("error", (error) => {
          observe("child-error", { code: typeof error.code === "string" ? error.code.slice(0, 64) : null });
          throw error;
        });
        child.once("exit", (code, signal) => observe("child-exited", { code, signal }));
        writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
        return child;
      };
      const stopChild = () => {
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
      };
      pi.on("session_shutdown", (event) => {
        observe("session-shutdown", { reason: event.reason });
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
          name: ${JSON.stringify(CONTROLLED_MODEL_LABEL)},
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 256
        }],
        streamSimple: (model, _context, options) => {
          observe("provider-started", { aborted: options?.signal?.aborted === true });
          ${teamKnowledgeEvidencePath ? `writeFileSync(${JSON.stringify(teamKnowledgeEvidencePath)}, JSON.stringify({
            canonicalMode: process.env.PI67_CANONICAL_TEAM_KNOWLEDGE,
            privateMode: process.env.PI67_MANAGED_LOCAL_MEMORY,
            tools: getCurrentTools(_context.messages).map(tool => tool.name)
          }), { mode: 0o600 });` : ""}
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
          if (nativeProbeRequested(_context.messages)) {
            const hasResult = _context.messages.some((message) => (
              message.role === "toolResult" && message.toolName === nativeToolName
            ));
            nativeModelSelected = true;
            writeNativeEvidence();
            if (!hasResult) {
              output.content = [{ type: "toolCall", id: "packaged-native-mcp-call", name: nativeToolName, arguments: {} }];
              output.stopReason = "toolUse";
            } else {
              output.content = [{ type: "text", text: "Packaged native MCP smoke completed." }];
            }
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "start", partial: output });
            stream.push({ type: "done", reason: output.stopReason, message: output });
            stream.end();
            return stream;
          }
          const activeChild = startChild();
          let settled = false;
          const settle = (reason) => {
            if (settled) return;
            settled = true;
            observe("stream-settled", { reason });
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
            observe("provider-aborted");
            stopChild();
            settle("aborted");
          }, { once: true });
          activeChild.once("exit", () => settle(options?.signal?.aborted ? "aborted" : "stop"));
          return stream;
        }
      });
      pi.on("tool_call", (event) => {
        if (event.toolName === nativeToolName) nativeToolCallObserved = true;
      });
      pi.on("tool_result", (event) => {
        if (event.toolName !== nativeToolName) return;
        nativeResult = event;
        writeNativeEvidence();
      });
      pi.on("before_agent_start", async (_event, ctx) => {
        const model = ctx.modelRegistry.find(
          ${JSON.stringify(CONTROLLED_PROVIDER_ID)},
          ${JSON.stringify(CONTROLLED_MODEL_ID)}
        );
        if (model && (ctx.model?.provider !== model.provider || ctx.model?.id !== model.id)) {
          await pi.setModel(model);
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
