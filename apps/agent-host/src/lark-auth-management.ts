import { homedir } from "node:os";
import type {
  LarkAppConfigurationInput,
  LarkAuthLoginStartResult,
  LarkAuthSnapshot
} from "@pi67/domain";
import { resolveLarkCli, larkCliProcessEnvironment } from "./lark-cli-resolution.js";
import {
  errorSnapshot,
  missingCliSnapshot,
  normalizeApplicationInput,
  parseConnectionSetupUrl,
  parseLoginStart,
  parseStatus
} from "./lark-auth-parsing.js";
import {
  appendBoundedProcessOutput,
  decodeSkillPackProcessOutput
} from "./skill-pack-process-execution.js";
import {
  runBoundedSkillPackProcess,
  type SkillPackProcessRunner
} from "./skill-pack-process-runner.js";
import { HostCommandError } from "./protocol-error.js";

const STATUS_TIMEOUT_MS = 20_000;
const LOGIN_START_TIMEOUT_MS = 30_000;
const CONNECTION_SETUP_TIMEOUT_MS = 10 * 60_000;
const CONNECTION_SETUP_URL_TIMEOUT_MS = 45_000;
const APPLICATION_CONFIGURATION_TIMEOUT_MS = 30_000;
export interface LarkAuthManagementPort {
  status(): Promise<LarkAuthSnapshot>;
  beginLogin(): Promise<LarkAuthLoginStartResult>;
  configureApplication(input: LarkAppConfigurationInput): Promise<LarkAuthSnapshot>;
  shutdown(): Promise<void>;
}

export interface LarkAuthManagementOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  now?: () => number;
  resolveLarkCli?: () => Promise<string | undefined>;
  runProcess?: SkillPackProcessRunner;
}

interface PendingLogin {
  readonly controller: AbortController;
  readonly result: LarkAuthLoginStartResult;
  readonly completion: Promise<void>;
}

interface PendingApplicationConfiguration {
  readonly controller: AbortController;
  readonly completion: Promise<LarkAuthSnapshot>;
}

export function createLarkAuthManagement(
  options: LarkAuthManagementOptions = {}
): LarkAuthManagementPort {
  return new LarkAuthManagement(options);
}

class LarkAuthManagement implements LarkAuthManagementPort {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #homeDirectory: string;
  readonly #now: () => number;
  readonly #runProcess: SkillPackProcessRunner;
  readonly #resolveLarkCli: () => Promise<string | undefined>;
  #pending: PendingLogin | undefined;
  #loginStarting: Promise<LarkAuthLoginStartResult> | undefined;
  #configuration: PendingApplicationConfiguration | undefined;
  #lastSnapshot: LarkAuthSnapshot | undefined;

  constructor(options: LarkAuthManagementOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#now = options.now ?? Date.now;
    this.#runProcess = options.runProcess ?? runBoundedSkillPackProcess;
    this.#resolveLarkCli = options.resolveLarkCli ?? (() => resolveLarkCli({
      environment: this.#environment,
      homeDirectory: this.#homeDirectory,
      shellPath: this.#environment.SHELL,
      runProcess: this.#runProcess
    }));
  }

  async status(): Promise<LarkAuthSnapshot> {
    const pending = this.#pending;
    if (pending) {
      if (pending.result.authorizationExpiresAt > this.#now()) {
        return { ...pending.result.status, checkedAt: this.#now() };
      }
      pending.controller.abort();
      this.#lastSnapshot = errorSnapshot(
        this.#now(),
        "飞书授权已过期，请重新发起登录。"
      );
      return this.#lastSnapshot;
    }

    if (this.#lastSnapshot) {
      const snapshot = this.#lastSnapshot;
      this.#lastSnapshot = undefined;
      return snapshot;
    }

    const executable = await this.#resolveLarkCli();
    if (!executable) return missingCliSnapshot(this.#now());
    return this.#readVerifiedStatus(executable);
  }

  async beginLogin(): Promise<LarkAuthLoginStartResult> {
    if (this.#loginStarting) return this.#loginStarting;
    const starting = this.#beginLoginUnlocked();
    this.#loginStarting = starting;
    try {
      return await starting;
    } finally {
      if (this.#loginStarting === starting) this.#loginStarting = undefined;
    }
  }

  async #beginLoginUnlocked(): Promise<LarkAuthLoginStartResult> {
    if (this.#configuration) {
      throw new Error("LARK_APP_CONFIGURATION_BUSY: 飞书应用配置正在保存，请稍后再登录。");
    }
    const existing = this.#pending;
    if (existing && existing.result.authorizationExpiresAt > this.#now()) return existing.result;
    if (existing) {
      existing.controller.abort();
      await existing.completion;
    }

    const executable = await this.#resolveLarkCli();
    if (!executable) throw new Error("LARK_CLI_NOT_FOUND: 未找到 lark-cli，请先安装或修复 Lark CLI。");
    try {
      return await this.#startUserAuthorization(executable);
    } catch (error) {
      if (isMissingApplicationConfiguration(error)) {
        return this.#startConnectionSetup(executable);
      }
      if (isLoginResponseValidationFailure(error)) throw error;
      if (isProcessTreeCleanupFailure(error)) throw error;
      throw new Error("LARK_AUTH_LOGIN_START_FAILED: 无法发起飞书用户授权，请检查网络后重试。");
    }
  }

  async #startUserAuthorization(executable: string): Promise<LarkAuthLoginStartResult> {
    let started: Awaited<ReturnType<SkillPackProcessRunner>>;
    started = await this.#runProcess(
      executable,
      ["auth", "login", "--recommend", "--no-wait", "--json"],
      {
        cwd: this.#homeDirectory,
        timeoutMs: LOGIN_START_TIMEOUT_MS,
        environment: larkCliProcessEnvironment(this.#environment, executable)
      }
    );
    const authorization = parseLoginStart(started.stdout, this.#now());
    const status: LarkAuthSnapshot = {
      cliStatus: "ready",
      phase: "authorizing",
      verified: false,
      checkedAt: this.#now(),
      appStatus: "unknown",
      detail: "授权页已打开；完成飞书确认后会自动更新连接状态。"
    };
    const result: LarkAuthLoginStartResult = {
      stage: "user-authorization",
      status,
      verificationUrl: authorization.verificationUrl,
      ...(authorization.userCode === undefined ? {} : { userCode: authorization.userCode }),
      authorizationExpiresAt: authorization.expiresAt
    };
    const controller = new AbortController();
    const completion = this.#completeLogin(
      executable,
      authorization.deviceCode,
      authorization.expiresAt,
      controller.signal
    );
    const pending: PendingLogin = { controller, result, completion };
    this.#pending = pending;
    void completion.finally(() => {
      if (this.#pending === pending) this.#pending = undefined;
    }).catch(() => undefined);
    return result;
  }

  async #startConnectionSetup(executable: string): Promise<LarkAuthLoginStartResult> {
    const controller = new AbortController();
    let stdoutOutput: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrOutput: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let resolveUrl!: (url: string) => void;
    let rejectUrl!: (error: Error) => void;
    let settledUrl = false;
    let setupUrlTimer: ReturnType<typeof setTimeout> | undefined;
    const setupUrl = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve;
      rejectUrl = reject;
    });
    const resolveSetupUrl = (url: string): void => {
      if (settledUrl) return;
      settledUrl = true;
      if (setupUrlTimer) clearTimeout(setupUrlTimer);
      resolveUrl(url);
    };
    const rejectSetupUrl = (error: Error): void => {
      if (settledUrl) return;
      settledUrl = true;
      if (setupUrlTimer) clearTimeout(setupUrlTimer);
      rejectUrl(error);
    };
    setupUrlTimer = setTimeout(() => {
      controller.abort();
      rejectSetupUrl(new Error("LARK_CONNECTION_SETUP_URL_TIMEOUT"));
    }, CONNECTION_SETUP_URL_TIMEOUT_MS);
    const observe = (stream: "stdout" | "stderr", chunk: Uint8Array): void => {
      const current = stream === "stdout" ? stdoutOutput : stderrOutput;
      const output = appendBoundedProcessOutput(current, Buffer.from(chunk));
      if (stream === "stdout") stdoutOutput = output;
      else stderrOutput = output;
      const parsed = parseConnectionSetupUrl(decodeSkillPackProcessOutput(output));
      if (parsed) resolveSetupUrl(parsed);
    };
    const running = this.#runProcess(
      executable,
      ["config", "init", "--new", "--brand", "feishu", "--lang", "zh"],
      {
        cwd: this.#homeDirectory,
        timeoutMs: CONNECTION_SETUP_TIMEOUT_MS,
        environment: larkCliProcessEnvironment(this.#environment, executable),
        signal: controller.signal,
        onOutput: ({ stream, chunk }) => observe(stream, chunk)
      }
    );
    const completion = running.then(async (result) => {
      observe("stdout", Buffer.from(result.stdout, "utf8"));
      observe("stderr", Buffer.from(result.stderr, "utf8"));
      rejectSetupUrl(new Error("LARK_CONNECTION_SETUP_URL_MISSING"));
      if (controller.signal.aborted) return;
      const snapshot = await this.#readVerifiedStatus(executable);
      this.#lastSnapshot = snapshot.appStatus === "ready"
        ? { ...snapshot, detail: "飞书基础连接已准备，正在继续个人用户授权。" }
        : errorSnapshot(this.#now(), "飞书基础连接未能通过验证，请重试。");
    }).catch((error: unknown) => {
      rejectSetupUrl(new Error("LARK_CONNECTION_SETUP_FAILED"));
      if (!controller.signal.aborted) {
        this.#lastSnapshot = errorSnapshot(
          this.#now(),
          "无法一键准备飞书连接；组织可能限制应用创建或审批，请联系管理员提供组织应用，或在“应用连接”中使用已有凭据。"
        );
      }
      if (isProcessTreeCleanupFailure(error)) throw error;
    });
    const verificationUrl = await setupUrl.catch(() => {
      controller.abort();
      throw new Error("LARK_CONNECTION_SETUP_FAILED: 无法发起飞书连接准备，请检查网络或组织策略后重试。");
    });
    const status: LarkAuthSnapshot = {
      cliStatus: "ready",
      phase: "authorizing",
      verified: false,
      checkedAt: this.#now(),
      appStatus: "missing",
      detail: "请在浏览器确认一键准备飞书连接；完成后将自动继续个人用户授权。"
    };
    const result: LarkAuthLoginStartResult = {
      stage: "connection-setup",
      status,
      verificationUrl,
      authorizationExpiresAt: this.#now() + CONNECTION_SETUP_TIMEOUT_MS
    };
    const pending: PendingLogin = { controller, result, completion };
    this.#pending = pending;
    void completion.finally(() => {
      if (this.#pending === pending) this.#pending = undefined;
    }).catch(() => undefined);
    return result;
  }

  async configureApplication(input: LarkAppConfigurationInput): Promise<LarkAuthSnapshot> {
    if (this.#configuration) {
      throw new Error("LARK_APP_CONFIGURATION_BUSY: 飞书应用配置正在保存，请稍后重试。");
    }
    const normalized = normalizeApplicationInput(input);
    const pendingLogin = this.#pending;
    if (pendingLogin) {
      pendingLogin.controller.abort();
      await pendingLogin.completion;
      if (this.#pending === pendingLogin) this.#pending = undefined;
    }
    const executable = await this.#resolveLarkCli();
    if (!executable) throw new Error("LARK_CLI_NOT_FOUND: 未找到 lark-cli，请先安装或修复 Lark CLI。");
    const controller = new AbortController();
    const completion = this.#saveApplicationConfiguration(executable, normalized, controller.signal);
    const pending = { controller, completion };
    this.#configuration = pending;
    try {
      return await completion;
    } finally {
      if (this.#configuration === pending) this.#configuration = undefined;
    }
  }

  async shutdown(): Promise<void> {
    const pending = this.#pending;
    const configuration = this.#configuration;
    pending?.controller.abort();
    configuration?.controller.abort();
    await Promise.allSettled([
      ...(pending ? [pending.completion] : []),
      ...(configuration ? [configuration.completion] : [])
    ]);
    if (this.#pending === pending) this.#pending = undefined;
    if (this.#configuration === configuration) this.#configuration = undefined;
  }

  async #saveApplicationConfiguration(
    executable: string,
    input: LarkAppConfigurationInput,
    signal: AbortSignal
  ): Promise<LarkAuthSnapshot> {
    const stdin = Buffer.from(`${input.appSecret}\n`, "utf8");
    try {
      await this.#runProcess(
        executable,
        ["config", "init", "--app-id", input.appId, "--app-secret-stdin", "--brand", input.brand],
        {
          cwd: this.#homeDirectory,
          timeoutMs: APPLICATION_CONFIGURATION_TIMEOUT_MS,
          environment: larkCliProcessEnvironment(this.#environment, executable),
          signal,
          stdin
        }
      );
      if (signal.aborted) throw new Error("LARK_APP_CONFIGURATION_CANCELLED");
      const snapshot = await this.#readVerifiedStatus(executable);
      if (snapshot.appStatus !== "ready" || snapshot.appId !== input.appId) {
        throw new Error("LARK_APP_CONFIGURATION_VERIFY_FAILED");
      }
      this.#lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (isProcessTreeCleanupFailure(error)) throw error;
      if (signal.aborted) throw new Error("LARK_APP_CONFIGURATION_CANCELLED: 飞书应用配置已取消。");
      throw new Error("LARK_APP_CONFIGURATION_FAILED: 无法验证并保存飞书应用，请检查 App ID 与 App Secret 后重试。");
    } finally {
      stdin.fill(0);
    }
  }

  async #completeLogin(
    executable: string,
    deviceCode: string,
    expiresAt: number,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await this.#runProcess(
        executable,
        ["auth", "login", "--device-code", deviceCode, "--json"],
        {
          cwd: this.#homeDirectory,
          timeoutMs: Math.max(1_000, expiresAt - this.#now() + 5_000),
          environment: larkCliProcessEnvironment(this.#environment, executable),
          signal
        }
      );
      if (signal.aborted) return;
      const snapshot = await this.#readVerifiedStatus(executable);
      this.#lastSnapshot = snapshot.phase === "connected"
        ? snapshot
        : errorSnapshot(this.#now(), "飞书已返回授权结果，但用户身份尚未验证，请重试。");
    } catch (error) {
      if (isProcessTreeCleanupFailure(error)) throw error;
      if (!signal.aborted) {
        this.#lastSnapshot = errorSnapshot(
          this.#now(),
          "飞书授权未完成或已过期，请重新登录。"
        );
      }
    }
  }

  async #readVerifiedStatus(executable: string): Promise<LarkAuthSnapshot> {
    try {
      const result = await this.#runProcess(
        executable,
        ["auth", "status", "--json", "--verify"],
        {
          cwd: this.#homeDirectory,
          timeoutMs: STATUS_TIMEOUT_MS,
          environment: larkCliProcessEnvironment(this.#environment, executable)
        }
      );
      return parseStatus(result.stdout, this.#now());
    } catch (error) {
      if (isProcessTreeCleanupFailure(error)) throw error;
      if (isMissingApplicationConfiguration(error)) {
        return {
          cliStatus: "ready",
          phase: "disconnected",
          verified: false,
          checkedAt: this.#now(),
          appStatus: "missing",
          detail: "首次登录时将一键准备飞书连接，无需填写 App ID 或 App Secret。"
        };
      }
      return errorSnapshot(this.#now(), "无法验证飞书用户授权，请检查网络后重试。");
    }
  }
}

function isProcessTreeCleanupFailure(error: unknown): error is HostCommandError {
  return error instanceof HostCommandError && error.code === "RUNTIME_POISONED";
}

function isMissingApplicationConfiguration(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /not[_ -]?configured|missing app config|尚未配置|未配置.*应用/iu.test(error.message);
}

function isLoginResponseValidationFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("LARK_AUTH_LOGIN_INVALID:");
}
