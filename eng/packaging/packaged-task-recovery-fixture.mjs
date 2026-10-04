import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const RECOVERY_SCENARIOS = ["agent-before-response", "app-after-tool", "agent-unconfirmed-tool"];
export const RECOVERY_RESPONSE = "Synthetic interrupted task successfully continued.";

export function selectRecoveryScenario(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length !== 1 || !RECOVERY_SCENARIOS.includes(args[0])) {
    throw new Error(`Select exactly one bounded scenario: ${RECOVERY_SCENARIOS.join(", ")}`);
  }
  return args[0];
}

// Only installed inside this runner's isolated test window. No payloads or results.
export async function observeRecoveryProtocol(page) {
  await page.evaluate(() => {
    const records = [];
    globalThis.__pi67RecoveryProtocol = records;
    const record = (data, direction) => {
      if (!data || !["request", "response", "event"].includes(data.kind)) return;
      if (!["runtime.initialize", "workspace.open", "runtime.ready", "projection.resync", "task.close", "session.recovery.inspect", "session.recovery.continue"].includes(data.type)) return;
      records.push({ direction, kind: data.kind, type: data.type, hostEpoch: data.hostEpoch,
        requestId: data.requestId, taskId: data.context?.taskId, taskGeneration: data.context?.taskGeneration,
        sessionGeneration: data.context?.sessionGeneration, ok: data.ok, errorCode: data.error?.code,
        expectedGeneration: data.error?.details?.expectedSessionGeneration,
        receivedGeneration: data.error?.details?.receivedSessionGeneration });
      if (records.length > 256) records.shift();
    };
    window.addEventListener("message", event => {
      for (const port of event.ports) {
        const post = port.postMessage.bind(port);
        port.postMessage = (...args) => { record(args[0], "send"); return post(...args); };
        port.addEventListener("message", message => record(message.data, "receive"));
      }
    });
  });
}

export async function prepareTaskRecoveryProfile(directories, scenario) {
  if (!RECOVERY_SCENARIOS.includes(scenario)) throw new Error("Unknown recovery scenario.");
  const observationPath = join(directories.userDataDirectory, "recovery-observations.jsonl");
  const crashMarker = join(directories.userDataDirectory, "crash-once");
  const effectPath = join(directories.workspace, "synthetic-effect.txt");
  await writeFile(join(directories.agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "pi67-auto", defaultModel: "auto", cacheWarming: "off",
    retry: { enabled: false }, compaction: { enabled: false },
    pi67Desktop: { autoRouting: Object.fromEntries(["judge", "standard", "complex"].map(role => [role, { provider: "pi67-recovery-fixture", model: role }])) }
  }));
  await writeFile(join(directories.agentDir, "openviking.json"), JSON.stringify({ enabled: false }));
  await writeFile(join(directories.extensionsDirectory, "task-recovery.ts"), `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createAssistantMessageEventStream, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
const scenario = ${JSON.stringify(scenario)};
const crashMarker = ${JSON.stringify(crashMarker)};
const effectPath = ${JSON.stringify(effectPath)};
const record = data => appendFileSync(${JSON.stringify(observationPath)}, JSON.stringify({ ...data, pid: process.pid }) + "\\n");
const exitReceiptKey = Symbol.for("pi67.syntheticRecoveryExit");
if (!process[exitReceiptKey]) {
  process[exitReceiptKey] = true;
  process.once("exit", code => record({ kind: "host-exit", code }));
}
globalThis.fetch = async () => { record({ kind: "network-denied" }); throw new Error("Synthetic recovery fixture forbids network requests."); };
function answer(model, content, reason = "stop") {
  const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
    stopReason: reason, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason, message }); stream.end(); return stream;
}
export default function recoveryFixture(pi) {
  record({ kind: "loaded", parentPid: process.ppid });
  pi.registerProvider("pi67-recovery-fixture", {
    name: "Synthetic recovery", baseUrl: "https://recovery.invalid", apiKey: "synthetic-only", api: "openai-responses",
    models: ["judge", "standard", "complex"].map(id => ({ id, name: "Recovery " + id, reasoning: false, input: ["text"],
      contextWindow: 32768, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    streamSimple(model, context) {
      if (getCurrentSystemPrompt(context.messages).includes("stable navigation title")) {
        record({ kind: "title", model: model.id });
        return answer(model, [{ type: "text", text: "Synthetic recovery task" }]);
      }
      if (model.id === "judge") {
        record({ kind: "judge", model: model.id });
        return answer(model, [{ type: "text", text: '{"complexity":"complex"}' }]);
      }
      const hasToolResult = context.messages.some(message => message.role === "toolResult" && message.toolName === "write");
      record({ kind: "candidate", model: model.id, hasToolResult });
      if (scenario === "agent-before-response" && !existsSync(crashMarker)) {
        writeFileSync(crashMarker, "armed"); record({ kind: "crash", boundary: "before-response" }); process.exit(86);
      }
      if (scenario !== "agent-before-response" && !hasToolResult) {
        return answer(model, [{ type: "toolCall", id: "recovery-write-once", name: "write",
          arguments: { path: effectPath, content: "synthetic effect confirmed on disk" } }], "toolUse");
      }
      if (scenario === "app-after-tool" && !existsSync(crashMarker)) {
        writeFileSync(crashMarker, "armed"); record({ kind: "await-main-crash", hasToolResult });
        return createAssistantMessageEventStream();
      }
      return answer(model, [{ type: "text", text: ${JSON.stringify(RECOVERY_RESPONSE)} }]);
    }
  });
  pi.on("tool_result", event => {
    if (event.toolName !== "write") return;
    record({ kind: "tool-effect", succeeded: !event.isError, exists: existsSync(effectPath) });
    if (scenario === "agent-unconfirmed-tool" && !existsSync(crashMarker)) {
      writeFileSync(crashMarker, "armed"); record({ kind: "crash", boundary: "unconfirmed-tool" }); process.exit(87);
    }
  });
}
`, "utf8");
  return { observationPath, effectPath };
}
