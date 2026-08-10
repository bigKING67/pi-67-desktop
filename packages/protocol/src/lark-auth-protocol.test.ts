import { describe, expect, it } from "vitest";
import { Value } from "./typebox-schema.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { hasValidCommandContext } from "./protocol-context.js";
import { CommandResultSchemas } from "./schemas.js";

const connected = {
  cliStatus: "ready",
  phase: "connected",
  verified: true,
  checkedAt: 1_000,
  appStatus: "ready",
  appId: "cli_test123",
  appBrand: "feishu",
  appName: "Pi-67",
  userName: "测试用户",
  tokenStatus: "needs-refresh",
  tokenExpiresAt: 2_000,
  detail: "飞书用户身份可用，访问令牌将在下一次用户 API 调用时自动续期。"
} as const;

describe("Lark authorization protocol", () => {
  it("requires App authority and empty command payloads", () => {
    for (const type of ["lark.auth.status", "lark.auth.login.begin"] as const) {
      expect(hasValidCommandContext(type, { scope: "app" })).toBe(true);
      expect(hasValidCommandContext(type, { scope: "workspace", workspaceId: "workspace-1" })).toBe(false);
      expect(hasValidCommandContext(type, {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 1
      })).toBe(false);
      expect(Value.Check(CommandPayloadSchemas[type], {})).toBe(true);
      expect(Value.Check(CommandPayloadSchemas[type], { scope: "all" })).toBe(false);
    }
  });

  it("accepts a bounded one-shot application credential payload only with App authority", () => {
    const type = "lark.app.configuration.save";
    const payload = { appId: "cli_test123", appSecret: "app-secret-123", brand: "feishu" } as const;
    expect(hasValidCommandContext(type, { scope: "app" })).toBe(true);
    expect(hasValidCommandContext(type, { scope: "workspace", workspaceId: "workspace-1" })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas[type], payload)).toBe(true);
    expect(Value.Check(CommandPayloadSchemas[type], { ...payload, appId: "invalid" })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas[type], { ...payload, appSecret: "has whitespace" })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas[type], { ...payload, brand: "unknown" })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas[type], { ...payload, token: "must-not-be-accepted" })).toBe(false);
    expect(Value.Check(CommandResultSchemas[type], connected)).toBe(true);
  });

  it("accepts bounded application identity state and rejects secrets or unrelated auth fields", () => {
    expect(Value.Check(CommandResultSchemas["lark.auth.status"], connected)).toBe(true);
    for (const forbidden of [
      { token: "secret" },
      { accessToken: "secret" },
      { deviceCode: "device-secret" },
      { openId: "ou_secret" },
      { scope: "drive:drive" },
      { appSecret: "app-secret" },
      { tenantAccessToken: "tenant-secret" }
    ]) {
      expect(Value.Check(CommandResultSchemas["lark.auth.status"], {
        ...connected,
        ...forbidden
      })).toBe(false);
    }
  });

  it("accepts only a bounded HTTPS verification URL without credentials", () => {
    const result = {
      status: {
        ...connected,
        phase: "authorizing",
        verified: false,
        appStatus: "unknown"
      },
      verificationUrl: "https://open.feishu.cn/device?state=opaque",
      userCode: "ABCD-EFGH",
      authorizationExpiresAt: 600_000
    } as const;
    expect(Value.Check(CommandResultSchemas["lark.auth.login.begin"], result)).toBe(true);
    expect(Value.Check(CommandResultSchemas["lark.auth.login.begin"], {
      ...result,
      verificationUrl: "http://open.feishu.cn/device"
    })).toBe(false);
    expect(Value.Check(CommandResultSchemas["lark.auth.login.begin"], {
      ...result,
      verificationUrl: "https://user:password@open.feishu.cn/device"
    })).toBe(false);
    expect(Value.Check(CommandResultSchemas["lark.auth.login.begin"], {
      ...result,
      verificationUrl: "https://open.feishu.cn/device\nunsafe"
    })).toBe(false);
    expect(Value.Check(CommandResultSchemas["lark.auth.login.begin"], {
      ...result,
      deviceCode: "must-not-cross-protocol"
    })).toBe(false);
  });
});
