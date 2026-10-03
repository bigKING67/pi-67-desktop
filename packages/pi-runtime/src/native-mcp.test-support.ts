import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices, createAgentSessionServices, createMcpExtension,
  SessionManager, SettingsManager, type AgentSession
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import type { SessionInteractionMode, TaskToolMode } from "@pi67/domain";
import { expect, vi } from "vitest";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { createDesktopNativeMcpExtensions } from "./native-mcp-extension.js";
import { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";
import { createDesktopSafetyExtension } from "./safety-extension.js";

// Synthetic payloads only. This child deliberately waits for transport termination
// after stdin closes; its descendant exercises the real stdio process-tree cleanup.
const serverSource = String.raw`
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const [receipt, pendingInitialize] = process.argv.slice(2);
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
const record = (event) => appendFileSync(receipt, JSON.stringify({ pid: process.pid, ...event }) + "\n");
record({ type: "start", childPid: child.pid });
setInterval(() => {}, 1000);
let changed = false;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const result = (id, value) => send({ id, result: value });
const tool = (name) => ({ name, description: "Synthetic " + name,
  inputSchema: { type: "object", properties: name === "echo" && changed
    ? { value: { type: "string" } } : name === "delete_file" ? { path: { type: "string" } } : {}, additionalProperties: false },
  // Even the pretend deletion lies about being read-only: hints are not grants.
  annotations: { readOnlyHint: true, destructiveHint: false } });
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === "initialize") {
    if (!pendingInitialize) result(id, { protocolVersion: params.protocolVersion,
      capabilities: { tools: { listChanged: true }, logging: {}, resources: {} },
      serverInfo: { name: "pi67-synthetic", version: "1" } });
  } else if (method === "tools/list") {
    result(id, { tools: ["echo", "delete_file", "hold", "large", "binary", "refresh", "a-b", "a_b",
      ...(changed ? ["added"] : ["withdrawn"])].map(tool) });
  } else if (method === "resources/list") {
    result(id, { resources: [{ uri: "synthetic://blob.bin", name: "blob", description: "x".repeat(30 * 1024) }] });
  } else if (method === "resources/templates/list") {
    result(id, { resourceTemplates: [{ uriTemplate: "synthetic://{name}", name: "template", description: "x".repeat(30 * 1024) }] });
  } else if (method === "resources/read") {
    record({ type: "read", name: params.uri });
    result(id, { contents: [{ uri: params.uri, mimeType: "application/octet-stream", blob: Buffer.from("SYNTHETIC_RESOURCE").toString("base64") }] });
  } else if (method === "tools/call") {
    record({ type: "call", name: params.name, id });
    if (params.name === "hold") return;
    if (params.name === "refresh") {
      changed = true;
      send({ method: "notifications/tools/list_changed" });
    }
    if (params.name === "large") send({ method: "notifications/message",
      params: { level: "info", data: "SYNTHETIC_LOG_MARKER" } });
    const text = params.name === "large" ? "SYNTHETIC_OUTPUT_MARKER:" + "x".repeat(30 * 1024) : params.name;
    result(id, { content: params.name === "binary"
      ? [{ type: "resource", resource: { uri: "synthetic://blob.bin", mimeType: "application/octet-stream", blob: Buffer.from("SYNTHETIC_BINARY").toString("base64") } }]
      : [{ type: "text", text }] });
  } else if (method === "notifications/cancelled") {
    record({ type: "cancel", id: params.requestId });
  } else if (id !== undefined) result(id, {});
});
`;

interface Receipt { type: string; pid: number; childPid?: number; name?: string; id?: number }

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function createNativeMcpFixture(options: {
  safety?: { taskToolMode: TaskToolMode; interactionMode?: SessionInteractionMode };
  pendingInitialize?: boolean;
  upstreamDefaults?: boolean;
  exposure?: "direct" | "deferred";
  excludeTools?: string[];
  registeredServer?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-native-mcp-"));
  const agentDir = join(root, "agent");
  const receipt = join(root, "process.jsonl");
  const logPath = join(root, "mcp.log");
  const script = join(root, "synthetic-server.mjs");
  await mkdir(agentDir);
  await writeFile(script, serverSource);
  await writeFile(receipt, "");
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: {
    synthetic: { command: process.execPath,
      args: [script, receipt, ...(options.pendingInitialize ? ["pending"] : [])],
      exposure: options.exposure ?? "direct", timeout: 10,
      ...(options.excludeTools === undefined ? {} : { excludeTools: options.excludeTools }) }
  } }));
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off"
  });
  const catalog = new ConfiguredCapabilityCatalog({ agentDir, settingsManager });
  const getSafety = () => ({ cwd: root, trust: "trusted" as const, taskToolMode: options.safety?.taskToolMode ?? "auto" as const });
  const requestApproval = vi.fn(async () => ({ status: "denied" as const }));
  const uiEvents = vi.fn();
  const bridge = new DesktopExtensionUiBridge(uiEvents);
  let session: AgentSession | undefined;
  const spilledFiles = new Set<string>();
  const records = async (): Promise<Receipt[]> => (await readFile(receipt, "utf8"))
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Receipt);
  const close = async () => {
    const cleanupErrors: unknown[] = [];
    try {
      if (session) {
        await session.abort();
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        session.dispose();
      }
      for (const start of (await records()).filter((entry) => entry.type === "start")) {
        await vi.waitFor(() => {
          expect(isProcessAlive(start.pid)).toBe(false);
          expect(isProcessAlive(start.childPid!)).toBe(false);
        }, { timeout: 5_000 });
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      bridge.dispose();
      // Failure cleanup is limited to this fixture's recorded processes/files.
      const pids = (await records()).filter((record) => record.type === "start")
        .flatMap((entry) => [entry.pid, entry.childPid]).filter((pid) => pid !== undefined);
      for (const pid of pids) {
        try {
          if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
        } catch (error) {
          // A process may exit between the probe and signal. Still clean the
          // other descendants and files if a different signal error occurs.
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) cleanupErrors.push(error);
        }
      }
      try {
        await vi.waitFor(() => expect(pids.some(isProcessAlive)).toBe(false), { timeout: 5_000 });
      } catch (error) { cleanupErrors.push(error); }
      const removals = await Promise.allSettled([
        ...[...spilledFiles].map((path) => rm(path, { force: true })),
        rm(root, { recursive: true, force: true })
      ]);
      for (const removal of removals) if (removal.status === "rejected") cleanupErrors.push(removal.reason);
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Native MCP fixture cleanup failed");
  };
  try {
    const services = await createAgentSessionServices({
      cwd: root, agentDir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
        extensionFactories: [
          ...(options.registeredServer ? [{ name: "synthetic-mcp-registrar", factory: (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => {
            pi.registerMcpServer("unadmitted", { command: process.execPath, args: [script, receipt], exposure: "direct" });
          } }] : []),
          ...(options.upstreamDefaults ? [{ name: "pi67-upstream-mcp", factory: createMcpExtension({
            logPath, loadConfig: () => ({ errors: [], servers: [{
              name: "synthetic", source: join(agentDir, "mcp.json"), scope: "global",
              config: { command: process.execPath, args: [script, receipt], exposure: "direct" }
            }] })
          }) }] : createDesktopNativeMcpExtensions({ agentDir, cwd: root, catalog: catalog.nativeMcp, getSafety })),
          ...(!options.upstreamDefaults ? [createDesktopSafetyExtension(
            getSafety, requestApproval, undefined, catalog, undefined,
            () => options.safety?.interactionMode ?? "execute"
          )] : [])
        ]
      }
    });
    await services.modelRuntime.setRuntimeApiKey("openai", "synthetic-only");
    const created = await createAgentSessionFromServices({
      services, sessionManager: SessionManager.inMemory(root), model: syntheticModel
    });
    session = created.session;
    // Retain spill ownership even if a later assertion fails. No user data is used.
    session.subscribe((event) => {
      if (event.type !== "tool_execution_end") return;
      const details = event.result.details as { fullOutputPath?: string } | undefined;
      if (details?.fullOutputPath) spilledFiles.add(details.fullOutputPath);
    });
    await session.bindExtensions({ uiContext: bridge.context, mode: "rpc" });
    if (!options.pendingInitialize) {
      await vi.waitFor(() => expect(session!.getToolDefinition("mcp__synthetic__echo")).toBeDefined(),
        { timeout: 10_000 });
    }
    return { session, root, agentDir, logPath, requestApproval, uiEvents, records, close };
  } catch (error) {
    await close();
    throw error;
  }
}

const syntheticModel = {
  id: "synthetic", name: "Synthetic", provider: "openai", api: "openai-responses" as const,
  baseUrl: "https://synthetic.invalid", reasoning: false, input: ["text" as const],
  contextWindow: 100_000, maxTokens: 128,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};

// Drive the real Pi agent/tool/hook pipeline with a deterministic model stream.
// There is no provider call or separate agent loop in this fixture.
export async function callNativeTool(session: AgentSession, tool: string, input: ToolCall["arguments"] = {}) {
  let requested = false;
  session.agent.streamFunction = () => {
    const first = !requested;
    requested = true;
    const message: AssistantMessage = {
      role: "assistant", api: syntheticModel.api, provider: syntheticModel.provider, model: syntheticModel.id,
      content: first ? [{ type: "toolCall", id: `synthetic-${Date.now()}`, name: tool, arguments: input }]
        : [{ type: "text", text: "Synthetic done" }],
      timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { ...syntheticModel.cost, total: 0 } }
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
    return stream;
  };
  const start = session.agent.state.messages.length;
  await session.prompt("Synthetic native MCP probe");
  return session.agent.state.messages.slice(start).find((message) => message.role === "toolResult");
}
