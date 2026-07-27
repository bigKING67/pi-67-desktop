import { randomUUID } from "node:crypto";
import {
  MessageChannelMain,
  utilityProcess,
  type BrowserWindow,
  type UtilityProcess
} from "electron";
import {
  isAgentHostRuntimePoisonedMessage,
  isAgentHostShutdownCompleteMessage,
  type AgentHostShutdownCompleteMessage,
  type AgentHostShutdownRequest
} from "@pi67/protocol";
import {
  agentHostEnvironment,
  type AgentHostStoragePaths
} from "./agent-host-environment.js";
import { planAgentHostRestart } from "./agent-host-restart.js";
import { redact } from "./redaction.js";
import { isExpectedRendererLocation } from "./renderer-security.js";

interface AgentHostIdentity {
  hostEpoch: number;
  hostInstanceId: string;
}

interface AgentHostSupervisorOptions {
  agentHostEntry: string;
  appInstanceId: string;
  expectedRendererOrigin: string;
  getStoragePaths: () => AgentHostStoragePaths;
  getMainWindow: () => BrowserWindow | undefined;
  rendererUrl: string;
  shutdownDeadlineMs?: number;
}

export interface AgentHostStopResult {
  graceful: boolean;
  forced: boolean;
  activeOperation: AgentHostShutdownCompleteMessage["activeOperation"];
  queuedCommandsDropped: number;
  extensionRequestsCancelled: number;
}

const DEFAULT_SHUTDOWN_DEADLINE_MS = 4_000;

export class AgentHostSupervisor {
  readonly #options: AgentHostSupervisorOptions;
  #agentHost: UtilityProcess | undefined;
  #identity: AgentHostIdentity | undefined;
  #nextHostEpoch = 0;
  #restartHistory: number[] = [];
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #poisonedRuntimeTimer: ReturnType<typeof setTimeout> | undefined;
  #stopping = false;
  #stopPromise: Promise<AgentHostStopResult> | undefined;
  #resolveStop: ((result: AgentHostStopResult) => void) | undefined;
  #stopTimer: ReturnType<typeof setTimeout> | undefined;
  #stopHost: UtilityProcess | undefined;
  #shutdownComplete: AgentHostShutdownCompleteMessage | undefined;
  readonly #shutdownDeadlineMs: number;

  constructor(options: AgentHostSupervisorOptions) {
    this.#options = options;
    this.#shutdownDeadlineMs = shutdownDeadline(options.shutdownDeadlineMs);
  }

  connect(): void {
    if (this.#stopping) return;
    if (this.#agentHost && this.#identity) {
      this.attachPort();
      return;
    }
    this.#startAgentHost();
  }

  stop(): Promise<AgentHostStopResult> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopping = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    if (this.#poisonedRuntimeTimer) clearTimeout(this.#poisonedRuntimeTimer);
    this.#restartTimer = undefined;
    this.#poisonedRuntimeTimer = undefined;
    const host = this.#agentHost;
    if (!host) {
      this.#stopPromise = Promise.resolve(emptyStopResult(true, false));
      return this.#stopPromise;
    }

    this.#stopHost = host;
    this.#stopPromise = new Promise<AgentHostStopResult>((resolve) => {
      this.#resolveStop = resolve;
    });
    this.#stopTimer = setTimeout(() => this.#forceStop(host), this.#shutdownDeadlineMs);
    const request: AgentHostShutdownRequest = {
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: Math.max(100, this.#shutdownDeadlineMs - 250)
    };
    try {
      host.postMessage(request);
    } catch {
      this.#forceStop(host);
    }
    return this.#stopPromise;
  }

  attachPort(window = this.#options.getMainWindow()): void {
    if (this.#stopping || !this.#agentHost || !this.#identity || !window || window.isDestroyed()) return;
    if (!isExpectedRendererLocation(window.webContents.getURL(), this.#options.rendererUrl)) return;

    const { port1, port2 } = new MessageChannelMain();
    this.#agentHost.postMessage({
      type: "attach-port",
      appInstanceId: this.#options.appInstanceId,
      hostInstanceId: this.#identity.hostInstanceId,
      hostEpoch: this.#identity.hostEpoch
    }, [port1]);
    window.webContents.postMessage(
      "pi67:agent-port",
      {
        expectedOrigin: this.#options.expectedRendererOrigin,
        appInstanceId: this.#options.appInstanceId,
        hostEpoch: this.#identity.hostEpoch
      },
      [port2]
    );
  }

  #startAgentHost(): void {
    if (this.#agentHost || this.#restartTimer || this.#stopping) return;
    const identity = { hostEpoch: ++this.#nextHostEpoch, hostInstanceId: randomUUID() };
    const host = utilityProcess.fork(this.#options.agentHostEntry, [], {
      serviceName: "Pi-67 Agent Host",
      stdio: "pipe",
      env: agentHostEnvironment(process.env, this.#options.getStoragePaths())
    });
    this.#identity = identity;
    this.#agentHost = host;
    host.on("spawn", () => this.attachPort());
    host.on("message", (message) => this.#handleMessage(host, message));
    host.on("exit", (code) => this.#handleExit(host, code));
    host.stdout?.on("data", () => undefined);
    host.stderr?.on("data", (chunk) => {
      if (process.env.PI67_DEBUG_AGENT_STDERR !== "1") return;
      const message = redact(String(chunk)).slice(0, 2_000);
      if (message) console.error(`[agent-host] ${message}`);
    });
  }

  #handleExit(host: UtilityProcess, code: number): void {
    if (this.#agentHost !== host) return;
    if (this.#poisonedRuntimeTimer) clearTimeout(this.#poisonedRuntimeTimer);
    this.#poisonedRuntimeTimer = undefined;
    if (process.env.PI67_DEBUG_AGENT_STDERR === "1") {
      console.error(`[agent-host] utility process exited with code ${code}`);
    }
    this.#agentHost = undefined;
    this.#identity = undefined;
    if (this.#stopping) {
      if (this.#stopHost === host) {
        this.#completeStop(Boolean(this.#shutdownComplete) && code === 0, false);
      }
      return;
    }

    const restart = planAgentHostRestart(this.#restartHistory, Date.now());
    this.#restartHistory = restart.history;
    const window = this.#options.getMainWindow();
    if (!restart.recoverable) {
      window?.webContents.send("pi67:agent-host-failed", { code, recoverable: false });
      return;
    }

    window?.webContents.send("pi67:agent-host-failed", {
      code,
      recoverable: true,
      attempt: restart.attempt
    });
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined;
      this.#startAgentHost();
    }, restart.delay);
  }

  #handleMessage(host: UtilityProcess, message: unknown): void {
    if (
      this.#agentHost === host
      && this.#stopping
      && this.#stopHost === host
      && isAgentHostShutdownCompleteMessage(message)
    ) {
      this.#shutdownComplete = message;
      return;
    }
    if (
      this.#agentHost !== host
      || this.#stopping
      || this.#poisonedRuntimeTimer
      || !isAgentHostRuntimePoisonedMessage(message)
    ) return;
    this.#poisonedRuntimeTimer = setTimeout(() => {
      this.#poisonedRuntimeTimer = undefined;
      if (this.#agentHost === host && !this.#stopping) host.kill();
    }, 50);
  }

  #forceStop(host: UtilityProcess): void {
    if (this.#stopHost !== host || !this.#resolveStop) return;
    try {
      host.kill();
    } finally {
      this.#completeStop(false, true);
    }
  }

  #completeStop(graceful: boolean, forced: boolean): void {
    const resolve = this.#resolveStop;
    if (!resolve) return;
    if (this.#stopTimer) clearTimeout(this.#stopTimer);
    this.#stopTimer = undefined;
    this.#resolveStop = undefined;
    const completion = this.#shutdownComplete;
    resolve({
      graceful,
      forced,
      activeOperation: completion?.activeOperation ?? "none",
      queuedCommandsDropped: completion?.queuedCommandsDropped ?? 0,
      extensionRequestsCancelled: completion?.extensionRequestsCancelled ?? 0
    });
  }
}

function shutdownDeadline(value = DEFAULT_SHUTDOWN_DEADLINE_MS): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 10_000) {
    throw new RangeError("shutdownDeadlineMs must be an integer between 100 and 10000.");
  }
  return value;
}

function emptyStopResult(graceful: boolean, forced: boolean): AgentHostStopResult {
  return {
    graceful,
    forced,
    activeOperation: "none",
    queuedCommandsDropped: 0,
    extensionRequestsCancelled: 0
  };
}
