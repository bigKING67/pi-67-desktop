import { randomUUID } from "node:crypto";
import {
  MessageChannelMain,
  utilityProcess,
  type BrowserWindow,
  type UtilityProcess
} from "electron";
import {
  isAgentHostReadyMessage,
  isAgentHostRuntimePoisonedMessage,
  isAgentHostStartupFailedMessage,
  isAgentHostShutdownCompleteMessage,
  type AgentHostStartupFailedMessage,
  type AgentHostStartupState,
  type AgentHostShutdownCompleteMessage,
  type AgentHostShutdownRequest
} from "@pi67/protocol";
import {
  agentHostEnvironment,
  type AgentHostRuntimeEnvironment,
  type AgentHostStoragePaths
} from "./agent-host-environment.js";
import { planAgentHostRestart } from "./agent-host-restart.js";
import { AgentHostInitializationOutputForwarder } from "./agent-host-initialization-output.js";
import { redact } from "./redaction.js";
import { isExpectedRendererLocation } from "./renderer-security.js";
import { sendAgentHostStartupFailure } from "./agent-host-startup-notification.js";
import { emptyAgentHostStopResult, rendererDocumentHandoffKey, resolveAgentHostShutdownDeadline,
  type AgentHostStopResult, type AgentHostSupervisorDiagnostics, type AgentHostSupervisorPhase
} from "./agent-host-supervisor-contract.js";
export type { AgentHostStopResult, AgentHostSupervisorDiagnostics, AgentHostSupervisorPhase } from "./agent-host-supervisor-contract.js";

interface AgentHostIdentity {
  hostEpoch: number;
  hostInstanceId: string;
}

interface AgentHostSupervisorOptions {
  agentHostEntry: string;
  appInstanceId: string;
  expectedRendererOrigin: string;
  getStoragePaths: () => AgentHostStoragePaths;
  getRuntimeEnvironment?: () => AgentHostRuntimeEnvironment;
  getMainWindow: () => BrowserWindow | undefined;
  rendererUrl: string;
  shutdownDeadlineMs?: number;
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
  #hostReadyReceived = false;
  #lastHandoffKey: string | undefined;
  readonly #shutdownDeadlineMs: number;
  #phase: AgentHostSupervisorPhase = "idle";
  #processStartRequestedAt: number | undefined;
  #processStartedAt: number | undefined;
  #lastSpawnDurationMs: number | undefined;
  #lastExit: AgentHostSupervisorDiagnostics["lastExit"];
  #lastStartup: AgentHostSupervisorDiagnostics["lastStartup"];
  #lastStartupFailure: AgentHostSupervisorDiagnostics["lastStartupFailure"];
  #currentStartup: AgentHostStartupState | undefined;
  #structuredStartupFailure: {
    host: UtilityProcess;
    hostEpoch: number;
    message: AgentHostStartupFailedMessage;
  } | undefined;
  #startupBlocked = false;
  #lastFailureNotificationKey: string | undefined;
  #restartScheduledAt: number | undefined;
  #restartCount = 0;
  #portHandoffCount = 0;
  #lastPortHandoffAt: number | undefined;
  #poisonedRuntimeReplacementCount = 0;

  constructor(options: AgentHostSupervisorOptions) {
    this.#options = options;
    this.#shutdownDeadlineMs = resolveAgentHostShutdownDeadline(
      options.shutdownDeadlineMs,
      DEFAULT_SHUTDOWN_DEADLINE_MS
    );
  }

  diagnostics(): AgentHostSupervisorDiagnostics {
    return {
      phase: this.#phase,
      ...(this.#identity ? { hostEpoch: this.#identity.hostEpoch } : {}),
      ...(this.#processStartRequestedAt === undefined
        ? {}
        : { processStartRequestedAt: this.#processStartRequestedAt }),
      ...(this.#processStartedAt === undefined ? {} : { processStartedAt: this.#processStartedAt }),
      ...(this.#lastSpawnDurationMs === undefined ? {} : { lastSpawnDurationMs: this.#lastSpawnDurationMs }),
      ...(this.#lastExit ? { lastExit: { ...this.#lastExit } } : {}),
      ...(this.#lastStartup ? {
        lastStartup: {
          ...this.#lastStartup,
          issues: this.#lastStartup.issues.map((issue) => ({ ...issue }))
        }
      } : {}),
      ...(this.#lastStartupFailure ? {
        lastStartupFailure: {
          ...this.#lastStartupFailure,
          issue: { ...this.#lastStartupFailure.issue }
        }
      } : {}),
      ...(this.#restartScheduledAt === undefined ? {} : { restartScheduledAt: this.#restartScheduledAt }),
      restartCount: this.#restartCount,
      portHandoffCount: this.#portHandoffCount,
      ...(this.#lastPortHandoffAt === undefined ? {} : { lastPortHandoffAt: this.#lastPortHandoffAt }),
      poisonedRuntimeReplacementCount: this.#poisonedRuntimeReplacementCount,
      poisonedRuntimeReplacementPending: this.#poisonedRuntimeTimer !== undefined
    };
  }

  connect(replaceCurrent = false): void {
    if (this.#stopping) return;
    if (this.#startupBlocked) {
      this.#sendStructuredStartupFailure();
      return;
    }
    if (this.#agentHost && this.#identity) {
      this.attachPort(this.#options.getMainWindow(), replaceCurrent);
      return;
    }
    this.#startAgentHost();
  }

  /**
   * Restart the utility process so Main-owned env (e.g. team MCP token) is re-read.
   * Safe while the app remains running; not used for application quit.
   */
  restart(): void {
    if (this.#stopping) return;
    this.#startupBlocked = false;
    this.#structuredStartupFailure = undefined;
    this.#lastFailureNotificationKey = undefined;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = undefined;
    }
    const host = this.#agentHost;
    if (!host) {
      this.#startAgentHost();
      return;
    }
    try {
      host.kill();
    } catch {
      this.#agentHost = undefined;
      this.#identity = undefined;
      this.#lastHandoffKey = undefined;
      this.#startAgentHost();
    }
  }
  stop(shutdownDeadlineMs = this.#shutdownDeadlineMs): Promise<AgentHostStopResult> {
    if (this.#stopPromise) return this.#stopPromise;
    const resolvedShutdownDeadlineMs = resolveAgentHostShutdownDeadline(shutdownDeadlineMs, this.#shutdownDeadlineMs);
    this.#stopping = true;
    this.#phase = "stopping";
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    if (this.#poisonedRuntimeTimer) clearTimeout(this.#poisonedRuntimeTimer);
    this.#restartTimer = undefined;
    this.#poisonedRuntimeTimer = undefined;
    const host = this.#agentHost;
    if (!host) {
      this.#stopPromise = Promise.resolve(emptyAgentHostStopResult(true, false));
      return this.#stopPromise;
    }

    this.#stopHost = host;
    this.#stopPromise = new Promise<AgentHostStopResult>((resolve) => {
      this.#resolveStop = resolve;
    });
    this.#stopTimer = setTimeout(() => this.#forceStop(host), resolvedShutdownDeadlineMs);
    const request: AgentHostShutdownRequest = {
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: Math.max(100, resolvedShutdownDeadlineMs - 250)
    };
    try {
      host.postMessage(request);
    } catch {
      this.#forceStop(host);
    }
    return this.#stopPromise;
  }

  attachPort(window = this.#options.getMainWindow(), replaceCurrent = false): void {
    if (
      this.#stopping
      || this.#phase !== "running"
      || !this.#agentHost
      || !this.#identity
      || !window
      || window.isDestroyed()
    ) return;
    if (!isExpectedRendererLocation(window.webContents.getURL(), this.#options.rendererUrl)) return;
    const handoffKey = rendererDocumentHandoffKey(window, this.#identity.hostEpoch);
    if (!handoffKey || (!replaceCurrent && handoffKey === this.#lastHandoffKey)) return;

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
    if (this.#currentStartup) {
      window.webContents.send("pi67:agent-host-startup", {
        hostEpoch: this.#identity.hostEpoch,
        startup: this.#currentStartup
      });
    }
    this.#lastHandoffKey = handoffKey;
    this.#portHandoffCount += 1;
    this.#lastPortHandoffAt = Date.now();
  }

  #startAgentHost(): void {
    if (this.#agentHost || this.#restartTimer || this.#stopping) return;
    const identity = { hostEpoch: ++this.#nextHostEpoch, hostInstanceId: randomUUID() };
    this.#phase = "starting";
    this.#processStartRequestedAt = Date.now();
    this.#processStartedAt = undefined;
    this.#hostReadyReceived = false;
    this.#currentStartup = undefined;
    this.#structuredStartupFailure = undefined;
    this.#restartScheduledAt = undefined;
    let host: UtilityProcess;
    try {
      host = utilityProcess.fork(this.#options.agentHostEntry, [], {
        serviceName: "Pi-67 Agent Host",
        stdio: "pipe",
        env: agentHostEnvironment(
          process.env,
          this.#options.getStoragePaths(),
          this.#options.getRuntimeEnvironment?.()
        )
      });
    } catch (error) {
      this.#phase = "failed";
      throw error;
    }
    this.#identity = identity;
    this.#agentHost = host;
    host.on("spawn", () => {
      if (this.#agentHost !== host || this.#stopping) return;
      this.#processStartedAt = Date.now();
      this.#lastSpawnDurationMs = Math.max(
        0,
        this.#processStartedAt - (this.#processStartRequestedAt ?? this.#processStartedAt)
      );
      this.#promoteReadyHost(host);
    });
    host.on("message", (message) => this.#handleMessage(host, message));
    host.on("exit", (code) => this.#handleExit(host, code));
    host.stdout?.on("data", () => undefined);
    const initializationOutput = process.env.NODE_ENV === "test"
      && process.env.PI67_TEST_CAPTURE_AGENT_INIT === "1"
      ? new AgentHostInitializationOutputForwarder((line) => process.stderr.write(`${line}\n`))
      : undefined;
    host.stderr?.on("data", (chunk) => {
      initializationOutput?.write(chunk);
      if (process.env.PI67_DEBUG_AGENT_STDERR !== "1") return;
      const message = redact(String(chunk)).slice(0, 2_000);
      if (message) console.error(`[agent-host] ${message}`);
    });
  }

  #handleExit(host: UtilityProcess, code: number): void {
    if (this.#agentHost !== host) return;
    const structuredStartupFailure = this.#structuredStartupFailure?.host === host
      ? this.#structuredStartupFailure
      : undefined;
    if (this.#poisonedRuntimeTimer) clearTimeout(this.#poisonedRuntimeTimer);
    this.#poisonedRuntimeTimer = undefined;
    if (process.env.PI67_DEBUG_AGENT_STDERR === "1") {
      console.error(`[agent-host] utility process exited with code ${code}`);
    }
    this.#agentHost = undefined;
    this.#identity = undefined;
    this.#hostReadyReceived = false;
    this.#processStartedAt = undefined;
    this.#lastHandoffKey = undefined;
    if (this.#stopping) {
      if (this.#stopHost === host) {
        this.#completeStop(Boolean(this.#shutdownComplete) && code === 0, false);
      }
      return;
    }

    const exitedAt = Date.now();
    if (structuredStartupFailure) {
      this.#lastExit = { at: exitedAt, code, recoverable: false };
      this.#phase = "failed";
      this.#startupBlocked = true;
      return;
    }
    const restart = planAgentHostRestart(this.#restartHistory, exitedAt);
    this.#restartHistory = restart.history;
    this.#lastExit = {
      at: exitedAt,
      code,
      recoverable: restart.recoverable,
      ...(restart.recoverable ? { attempt: restart.attempt } : {})
    };
    const window = this.#options.getMainWindow();
    if (!restart.recoverable) {
      this.#phase = "failed";
      window?.webContents.send("pi67:agent-host-failed", { code, recoverable: false });
      return;
    }

    this.#restartCount += 1;
    window?.webContents.send("pi67:agent-host-failed", {
      code,
      recoverable: true,
      attempt: restart.attempt
    });
    this.#phase = "restart-scheduled";
    this.#restartScheduledAt = Date.now() + restart.delay;
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
      this.#agentHost === host
      && !this.#stopping
      && this.#phase === "starting"
      && isAgentHostReadyMessage(message)
    ) {
      const at = Date.now();
      this.#currentStartup = message.startup;
      this.#lastStartup = {
        at,
        hostEpoch: this.#identity!.hostEpoch,
        profileMode: message.startup.profileMode,
        status: message.startup.status,
        issues: message.startup.issues.map((issue) => ({ ...issue }))
      };
      this.#startupBlocked = false;
      this.#hostReadyReceived = true;
      this.#promoteReadyHost(host);
      return;
    }
    if (
      this.#agentHost === host
      && !this.#stopping
      && this.#phase === "starting"
      && isAgentHostStartupFailedMessage(message)
    ) {
      const hostEpoch = this.#identity!.hostEpoch;
      this.#structuredStartupFailure = { host, hostEpoch, message };
      this.#lastStartupFailure = {
        at: Date.now(),
        hostEpoch,
        ...(message.profileMode === undefined ? {} : { profileMode: message.profileMode }),
        issue: { ...message.issue }
      };
      this.#startupBlocked = true;
      this.#phase = "failed";
      this.#sendStructuredStartupFailure();
      return;
    }
    if (
      this.#agentHost !== host
      || this.#stopping
      || this.#poisonedRuntimeTimer
      || !isAgentHostRuntimePoisonedMessage(message)
    ) return;
    this.#poisonedRuntimeReplacementCount += 1;
    this.#poisonedRuntimeTimer = setTimeout(() => {
      this.#poisonedRuntimeTimer = undefined;
      if (this.#agentHost === host && !this.#stopping) host.kill();
    }, 50);
  }

  #promoteReadyHost(host: UtilityProcess): void {
    if (
      this.#agentHost !== host
      || this.#stopping
      || this.#phase !== "starting"
      || this.#processStartedAt === undefined
      || !this.#hostReadyReceived
    ) return;
    this.#phase = "running";
    this.attachPort();
  }

  #sendStructuredStartupFailure(): void {
    const failure = this.#structuredStartupFailure;
    if (!failure) return;
    this.#lastFailureNotificationKey = sendAgentHostStartupFailure({
      window: this.#options.getMainWindow(),
      rendererUrl: this.#options.rendererUrl,
      lastNotificationKey: this.#lastFailureNotificationKey,
      failure
    });
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
