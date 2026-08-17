import { describe, expect, it, vi } from "vitest";
import {
  createLarkAuthManagement,
  type LarkAuthManagementOptions
} from "./lark-auth-management.js";
import { parseConnectionSetupUrl } from "./lark-auth-parsing.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

const EXECUTABLE = "/tools/lark-cli";

describe("parseConnectionSetupUrl", () => {
  it("extracts only credential-free Feishu or Lark setup URLs", () => {
    expect(parseConnectionSetupUrl(
      "请打开 https://open.feishu.cn/setup/connection?state=opaque。"
    )).toBe("https://open.feishu.cn/setup/connection?state=opaque");
    expect(parseConnectionSetupUrl(
      "Open https://open.larksuite.com/setup/connection?state=opaque"
    )).toBe("https://open.larksuite.com/setup/connection?state=opaque");
  });

  it("rejects insecure, credential-bearing, or lookalike setup URLs", () => {
    expect(parseConnectionSetupUrl("http://open.feishu.cn/setup")).toBeUndefined();
    expect(parseConnectionSetupUrl("https://user:secret@open.feishu.cn/setup")).toBeUndefined();
    expect(parseConnectionSetupUrl("https://open.feishu.cn.evil.example/setup")).toBeUndefined();
  });
});

describe("LarkAuthManagement", () => {
  it("reports a missing CLI without loading credentials or starting authorization", async () => {
    const manager = createLarkAuthManagement({
      now: () => 1_000,
      resolveLarkCli: async () => undefined
    });

    await expect(manager.status()).resolves.toEqual({
      cliStatus: "missing",
      phase: "disconnected",
      verified: false,
      checkedAt: 1_000,
      appStatus: "unknown",
      detail: "未找到 lark-cli，请先安装或修复 Lark CLI。"
    });
    await expect(manager.beginLogin()).rejects.toThrow("LARK_CLI_NOT_FOUND");
  });

  it("treats missing application configuration as a normal first-login state", async () => {
    const runProcess = vi.fn<SkillPackProcessRunner>(async () => {
      throw new Error(
        "lark-cli exited with 3: {\"error\":{\"subtype\":\"not_configured\",\"message\":\"not configured\"}}"
      );
    });
    const manager = managerWith(runProcess, () => 1_500);

    await expect(manager.status()).resolves.toEqual({
      cliStatus: "ready",
      phase: "disconnected",
      verified: false,
      checkedAt: 1_500,
      appStatus: "missing",
      detail: "首次登录时将一键准备飞书连接，无需填写 App ID 或 App Secret。"
    });
  });

  it("parses verified user and bot identities while dropping sensitive CLI fields", async () => {
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_) => {
      expect(arguments_).toEqual(["auth", "status", "--json", "--verify"]);
      return {
        stdout: JSON.stringify({
          verified: true,
          identity: "user",
          appId: "cli_test123",
          brand: "feishu",
          identities: {
            bot: {
              status: "ready",
              available: true,
              verified: true,
              appName: "Pi-67 Office",
              openId: "ou_bot_secret",
              appSecret: "must-not-cross"
            },
            user: {
              status: "needs_refresh",
              available: true,
              verified: true,
              userName: "测试用户",
              tokenStatus: "needs_refresh",
              expiresAt: "2026-08-09T12:00:00.000Z",
              openId: "ou_user_secret",
              scope: ["drive:drive"],
              accessToken: "token-secret"
            }
          }
        }),
        stderr: ""
      };
    });
    const manager = managerWith(runProcess, () => 2_000);

    const snapshot = await manager.status();

    expect(snapshot).toMatchObject({
      cliStatus: "ready",
      phase: "connected",
      verified: true,
      checkedAt: 2_000,
      appStatus: "ready",
      appId: "cli_test123",
      appBrand: "feishu",
      appName: "Pi-67 Office",
      userName: "测试用户",
      tokenStatus: "needs-refresh"
    });
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      "ou_bot_secret",
      "ou_user_secret",
      "drive:drive",
      "token-secret",
      "must-not-cross"
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("configures an existing application through stdin and returns only verified redacted state", async () => {
    let stdin = "";
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, options) => {
      if (arguments_[0] === "config") {
        expect(arguments_).toEqual([
          "config",
          "init",
          "--app-id",
          "cli_test123",
          "--app-secret-stdin",
          "--brand",
          "feishu"
        ]);
        stdin = Buffer.from(options.stdin ?? []).toString("utf8");
        return { stdout: "configured", stderr: "" };
      }
      return {
        stdout: JSON.stringify({
          appId: "cli_test123",
          brand: "feishu",
          verified: true,
          identities: {
            bot: {
              status: "ready",
              available: true,
              verified: true,
              appName: "用户应用"
            },
            user: { status: "missing", available: false, verified: false }
          }
        }),
        stderr: ""
      };
    });
    const manager = managerWith(runProcess, () => 2_000);

    const snapshot = await manager.configureApplication({
      appId: "cli_test123",
      appSecret: "secret-value-123",
      brand: "feishu"
    });

    expect(stdin).toBe("secret-value-123\n");
    expect(runProcess.mock.calls[0]![1]).not.toContain("secret-value-123");
    expect(snapshot).toMatchObject({
      appStatus: "ready",
      appId: "cli_test123",
      appBrand: "feishu",
      appName: "用户应用"
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret-value-123");
  });

  it("sanitizes application configuration failures without echoing the submitted secret", async () => {
    const runProcess = vi.fn<SkillPackProcessRunner>(async () => {
      throw new Error("upstream echoed secret-value-123");
    });
    const manager = managerWith(runProcess, () => 2_000);

    const error = await manager.configureApplication({
      appId: "cli_test123",
      appSecret: "secret-value-123",
      brand: "feishu"
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "LARK_APP_CONFIGURATION_FAILED: 无法验证并保存飞书应用，请检查 App ID 与 App Secret 后重试。"
    );
    expect((error as Error).message).not.toContain("secret-value-123");
  });

  it("starts one Device Flow, keeps the device code Host-only and aborts it on shutdown", async () => {
    let pollingSignal: AbortSignal | undefined;
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, options) => {
      if (arguments_.includes("--no-wait")) {
        expect(arguments_).toEqual([
          "auth",
          "login",
          "--recommend",
          "--no-wait",
          "--json"
        ]);
        return {
          stdout: JSON.stringify({
            data: {
              device_code: "opaque-device-secret",
              verification_url: "https://open.feishu.cn/device?state=opaque",
              user_code: "ABCD-EFGH",
              expires_in: 600
            }
          }),
          stderr: ""
        };
      }
      if (arguments_.includes("--device-code")) {
        pollingSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      }
      throw new Error(`Unexpected command: ${arguments_.join(" ")}`);
    });
    const manager = managerWith(runProcess, () => 10_000);

    const first = await manager.beginLogin();
    const repeated = await manager.beginLogin();

    expect(repeated).toEqual(first);
    expect(first).toEqual({
      stage: "user-authorization",
      status: expect.objectContaining({ phase: "authorizing", appStatus: "unknown" }),
      verificationUrl: "https://open.feishu.cn/device?state=opaque",
      userCode: "ABCD-EFGH",
      authorizationExpiresAt: 610_000
    });
    expect(JSON.stringify(first)).not.toContain("opaque-device-secret");
    expect(runProcess.mock.calls.filter((call) => call[1].includes("--no-wait"))).toHaveLength(1);
    expect(runProcess.mock.calls.filter((call) => call[1].includes("--device-code"))).toHaveLength(1);
    expect(pollingSignal?.aborted).toBe(false);

    await manager.shutdown();
    expect(pollingSignal?.aborted).toBe(true);
  });

  it("prepares a missing App connection before continuing user authorization", async () => {
    let completeSetup!: () => void;
    const setupCompletion = new Promise<void>((resolve) => { completeSetup = resolve; });
    let appReady = false;
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, options) => {
      if (arguments_.includes("--no-wait")) {
        expect(arguments_).toEqual([
          "auth",
          "login",
          "--recommend",
          "--no-wait",
          "--json"
        ]);
        if (!appReady) throw new Error("not configured (missing app config)");
        return {
          stdout: JSON.stringify({
            device_code: "host-only-user-device-code",
            verification_url: "https://open.feishu.cn/device/user",
            expires_in: 600
          }),
          stderr: ""
        };
      }
      if (arguments_[0] === "config") {
        options.onOutput?.({
          stream: "stderr",
          chunk: Buffer.from("打开链接 https://open.feishu.cn/setup/connection?opaque=1\n", "utf8")
        });
        await setupCompletion;
        appReady = true;
        return { stdout: JSON.stringify({ appId: "cli_created123", appSecret: "****" }), stderr: "" };
      }
      if (arguments_.includes("status")) {
        return {
          stdout: JSON.stringify({
            verified: true,
            appId: "cli_created123",
            brand: "feishu",
            identities: {
              bot: { status: "ready", available: true, verified: true, appName: "一键连接" },
              user: { status: "missing", available: false, verified: false }
            }
          }),
          stderr: ""
        };
      }
      if (arguments_.includes("--device-code")) {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      }
      throw new Error(`Unexpected command: ${arguments_.join(" ")}`);
    });
    const manager = managerWith(runProcess, () => 10_000);

    const setup = await manager.beginLogin();
    expect(setup).toMatchObject({
      stage: "connection-setup",
      verificationUrl: "https://open.feishu.cn/setup/connection?opaque=1",
      status: { phase: "authorizing", appStatus: "missing" }
    });
    expect(JSON.stringify(setup)).not.toContain("host-only-user-device-code");

    completeSetup();
    await vi.waitFor(async () => {
      await expect(manager.status()).resolves.toMatchObject({
        phase: "disconnected",
        appStatus: "ready",
        appId: "cli_created123"
      });
    });

    const authorization = await manager.beginLogin();
    expect(authorization).toMatchObject({
      stage: "user-authorization",
      verificationUrl: "https://open.feishu.cn/device/user"
    });
    expect(runProcess.mock.calls.filter((call) => call[1][0] === "config")).toHaveLength(1);
    await manager.shutdown();
  });

  it("does not fabricate a setup URL by joining stdout and stderr", async () => {
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_, options) => {
      if (arguments_.includes("--no-wait")) throw new Error("not configured");
      if (arguments_[0] === "config") {
        options.onOutput?.({ stream: "stdout", chunk: Buffer.from("https://open.", "utf8") });
        options.onOutput?.({ stream: "stderr", chunk: Buffer.from("feishu.cn/setup\n", "utf8") });
        return { stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected command: ${arguments_.join(" ")}`);
    });
    const manager = managerWith(runProcess, () => 10_000);

    await expect(manager.beginLogin()).rejects.toThrow("LARK_CONNECTION_SETUP_FAILED");
  });

  it("publishes the verified status after the Device Flow completes", async () => {
    const runProcess = vi.fn<SkillPackProcessRunner>(async (_executable, arguments_) => {
      if (arguments_.includes("--no-wait")) {
        return {
          stdout: JSON.stringify({
            deviceCode: "host-only-device-code",
            verification_uri_complete: "https://open.feishu.cn/device/complete",
            expiresIn: 600
          }),
          stderr: ""
        };
      }
      if (arguments_.includes("--device-code")) return { stdout: "{}", stderr: "" };
      if (arguments_.includes("status")) {
        return {
          stdout: JSON.stringify({
            verified: true,
            identities: {
              bot: { status: "missing", available: false, verified: false },
              user: {
                status: "ready",
                available: true,
                verified: true,
                userName: "授权完成用户",
                tokenStatus: "valid",
                expiresAt: 2_000_000
              }
            }
          }),
          stderr: ""
        };
      }
      throw new Error(`Unexpected command: ${arguments_.join(" ")}`);
    });
    const manager = managerWith(runProcess, () => 20_000);

    await manager.beginLogin();
    await vi.waitFor(async () => {
      await expect(manager.status()).resolves.toMatchObject({
        phase: "connected",
        verified: true,
        userName: "授权完成用户",
        tokenStatus: "valid",
        appStatus: "missing"
      });
    });

    expect(JSON.stringify(await manager.status())).not.toContain("host-only-device-code");
    await manager.shutdown();
  });

  it("fails closed for an insecure verification URL and sanitizes process failures", async () => {
    const insecureRunner = vi.fn<SkillPackProcessRunner>(async () => ({
      stdout: JSON.stringify({
        device_code: "device-secret",
        verification_url: "http://open.feishu.cn/device"
      }),
      stderr: ""
    }));
    const insecure = managerWith(insecureRunner, () => 1_000);
    await expect(insecure.beginLogin()).rejects.toThrow("LARK_AUTH_LOGIN_INVALID");

    const failingRunner = vi.fn<SkillPackProcessRunner>(async () => {
      throw new Error("upstream failed with device-secret and token-secret");
    });
    const failing = managerWith(failingRunner, () => 1_000);
    const error = await failing.beginLogin().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "LARK_AUTH_LOGIN_START_FAILED: 无法发起飞书用户授权，请检查网络后重试。"
    );
    expect((error as Error).message).not.toContain("device-secret");
    expect((error as Error).message).not.toContain("token-secret");
  });
});

function managerWith(
  runProcess: SkillPackProcessRunner,
  now: () => number
) {
  const options: LarkAuthManagementOptions = {
    environment: { PATH: "/tools" },
    homeDirectory: "/home/pi67",
    now,
    resolveLarkCli: async () => EXECUTABLE,
    runProcess
  };
  return createLarkAuthManagement(options);
}
