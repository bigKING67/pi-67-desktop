import type { RuntimeStatus } from "@pi67/domain";
import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  agentEventEnvelope,
  isCommandEnvelope,
  responseEnvelope,
  type AgentCommand,
  type AgentEvent,
  type CommandResponse,
  type ProtocolPort
} from "@pi67/protocol";

interface ParentMessageEvent {
  data: unknown;
  ports: ProtocolPort[];
}

interface UtilityParentPort {
  on(type: "message", listener: (event: ParentMessageEvent) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
if (!parentPort) throw new Error("Pi-67 Agent Host must run as an Electron utility process.");

let runtime: AgentRuntime | undefined;
let runtimeLoad: Promise<AgentRuntime> | undefined;
let port: ProtocolPort | undefined;
let sequence = 0;
let initialized = false;
let shuttingDown = false;

parentPort.on("message", (event) => {
  if (!isAttachPortMessage(event.data) || event.ports.length !== 1) return;
  const nextPort = event.ports[0];
  if (nextPort) attachPort(nextPort);
});

function attachPort(nextPort: ProtocolPort): void {
  port?.close?.();
  port = nextPort;
  if (nextPort.addEventListener) nextPort.addEventListener("message", handlePortMessage);
  else nextPort.on?.("message", handlePortMessage);
  nextPort.start?.();
  if (initialized && runtime) sendEvent({ type: "session.snapshot", payload: runtime.getSnapshot() });
}

function handlePortMessage(event: unknown): void {
  const data = typeof event === "object" && event !== null && "data" in event
    ? (event as { data: unknown }).data
    : event;
  if (!isCommandEnvelope(data)) {
    sendProtocolError("INVALID_COMMAND", "Agent Host rejected an invalid protocol envelope.");
    return;
  }
  void dispatch(data.command)
    .then((result) => port?.postMessage(responseEnvelope(data.requestId, { ok: true, ...(result === undefined ? {} : { data: result }) })))
    .catch((error: unknown) => {
      const response: CommandResponse = {
        ok: false,
        error: {
          code: errorCode(error),
          message: safeErrorMessage(error),
          recoverable: true
        }
      };
      port?.postMessage(responseEnvelope(data.requestId, response));
      sendEvent({ type: "turn.failed", payload: { message: response.error?.message ?? "Agent command failed." } });
    });
}

async function dispatch(command: AgentCommand): Promise<unknown> {
  if (command.type === "runtime.getStatus") return { initialized, loaded: runtime !== undefined };
  if (command.type === "runtime.initialize") {
    sendStatus({ phase: "starting", detail: "正在加载 Pi SDK", recoverable: true });
  }
  const activeRuntime = await loadRuntime();
  switch (command.type) {
    case "runtime.initialize": {
      const snapshot = await activeRuntime.initialize(command.payload);
      initialized = true;
      sendStatus({ phase: "ready", detail: "Pi SDK 已就绪", recoverable: true });
      sendEvent({
        type: "runtime.ready",
        payload: {
          capabilities: {
            sdkVersion: "0.81.1",
            supportsFollowUp: true,
            supportsSessionTree: true,
            supportsExtensionUi: true,
            supportsTuiCustomUi: false
          },
          snapshot
        }
      });
      return snapshot;
    }
    case "workspace.open":
      activeRuntime.setWorkspacePolicy(command.payload.trust, command.payload.approvalMode);
      return activeRuntime.createSession(command.payload.cwd);
    case "workspace.setTrust":
      activeRuntime.setWorkspacePolicy(command.payload.trust, command.payload.approvalMode);
      return activeRuntime.getSnapshot();
    case "session.list": {
      const sessions = await activeRuntime.listSessions(command.payload.all);
      sendEvent({ type: "session.listed", payload: { sessions } });
      return sessions;
    }
    case "session.create":
      return activeRuntime.createSession(command.payload.cwd);
    case "session.open":
      return activeRuntime.openSession(command.payload.path, command.payload.cwdOverride);
    case "session.import":
      return activeRuntime.importSession(command.payload.path);
    case "session.branch":
      return activeRuntime.branch(command.payload.entryId, command.payload.newFile);
    case "session.rollback":
      return activeRuntime.rollback(command.payload.entryId, command.payload.summarize);
    case "session.compact":
      return activeRuntime.compact(command.payload.instructions);
    case "session.name":
      return activeRuntime.setSessionName(command.payload.name);
    case "prompt.send":
      return activeRuntime.send(command.payload.text, command.payload.images);
    case "prompt.steer":
      return activeRuntime.steer(command.payload.text, command.payload.images);
    case "prompt.followUp":
      return activeRuntime.followUp(command.payload.text, command.payload.images);
    case "turn.abort":
      return activeRuntime.abort();
    case "model.list":
      return activeRuntime.getSnapshot().models;
    case "model.select":
      return activeRuntime.selectModel(command.payload.provider, command.payload.id);
    case "model.setRuntimeKey":
      return activeRuntime.setRuntimeApiKey(command.payload.provider, command.payload.apiKey);
    case "thinking.set":
      return activeRuntime.setThinkingLevel(command.payload.level);
    case "resource.list":
      return activeRuntime.getSnapshot().resources;
    case "resource.reload":
      return activeRuntime.reloadResources();
    case "command.list":
      return activeRuntime.getCommands();
    case "command.invoke":
      return activeRuntime.invokeCommand(command.payload.command);
    case "extension.ui.respond":
      return { resolved: activeRuntime.resolveExtensionUi(command.payload.requestId, command.payload.value, command.payload.cancelled) };
    case "diagnostics.collect":
      return activeRuntime.collectDiagnostics();
    case "doctor.run":
      return activeRuntime.runDoctor();
  }
}

async function loadRuntime(): Promise<AgentRuntime> {
  if (runtime) return runtime;
  runtimeLoad ??= import("@pi67/pi-runtime")
    .then(({ PiSdkRuntime }) => {
      const nextRuntime = new PiSdkRuntime();
      nextRuntime.subscribe((event) => sendEvent(event));
      runtime = nextRuntime;
      return nextRuntime;
    })
    .catch((error: unknown) => {
      runtimeLoad = undefined;
      throw error;
    });
  return runtimeLoad;
}

function sendEvent(event: AgentEvent): void {
  sequence += 1;
  let sessionId: string | undefined;
  if (initialized && runtime) {
    try {
      sessionId = runtime.getSnapshot().sessionId;
    } catch {
      sessionId = undefined;
    }
  }
  port?.postMessage(agentEventEnvelope(event, sequence, sessionId));
}

function sendStatus(status: RuntimeStatus): void {
  sendEvent({ type: "runtime.statusChanged", payload: status });
}

function sendProtocolError(code: string, message: string): void {
  sendEvent({ type: "turn.failed", payload: { message: `${code}: ${message}` } });
}

function isAttachPortMessage(value: unknown): value is { type: "attach-port" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "attach-port";
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown Agent Host error.";
  return error.message.replace(/(?:sk-|ghp_|Bearer\s+)[A-Za-z0-9._-]+/gu, "[redacted]");
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "AGENT_HOST_ERROR";
  if (error.message.includes("changed outside Desktop")) return "SESSION_CHANGED_EXTERNALLY";
  if (error.message.includes("not initialized")) return "RUNTIME_NOT_READY";
  if (error.message.includes("Unknown Pi model")) return "MODEL_NOT_FOUND";
  return "PI_RUNTIME_ERROR";
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await runtime?.dispose();
  port?.close?.();
}

process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("beforeExit", () => void shutdown());
