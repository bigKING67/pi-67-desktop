import { describe, expect, it, vi } from "vitest";
import {
  isResponseEnvelope,
  type AgentCommandType,
  type CommandPayloads,
  type ProtocolContext,
  type ResponseEnvelope
} from "@pi67/protocol";
import { AgentHostServer } from "./host-server.js";
import { attach, FakePort } from "./host-server-multi-task-fixture.js";
import { commandEnvelopeForContext } from "./protocol-test-fixtures.js";

const APP_CONTEXT = { scope: "app" as const };
describe("AgentHostServer Lark authorization", () => {
  it("routes App-scoped authorization without loading Pi", async () => {
    const snapshot = {
      cliStatus: "ready" as const,
      phase: "connected" as const,
      verified: true,
      checkedAt: 1_000,
      appStatus: "ready" as const,
      appId: "cli_test123",
      appBrand: "feishu" as const,
      appName: "Pi-67 Office",
      userName: "测试用户",
      tokenStatus: "valid" as const
    };
    const login = {
      stage: "user-authorization" as const,
      status: { ...snapshot, phase: "authorizing" as const, verified: false },
      verificationUrl: "https://open.feishu.cn/device",
      userCode: "ABCD-EFGH",
      authorizationExpiresAt: 601_000
    };
    const status = vi.fn(async () => snapshot);
    const beginLogin = vi.fn(async () => login);
    const configureApplication = vi.fn(async () => snapshot);
    const shutdown = vi.fn(async () => undefined);
    const runtimeLoader = vi.fn(async () => { throw new Error("Pi Runtime must not load."); });
    const server = new AgentHostServer(runtimeLoader, {
      sdkVersionLoader: async () => "0.81.1",
      larkAuthManagement: { status, beginLogin, configureApplication, shutdown }
    });
    const port = new FakePort();
    await attach(server, port);

    const statusResponse = await command(port, APP_CONTEXT, "lark.auth.status", {});
    if (!statusResponse.ok) throw new Error(JSON.stringify(statusResponse.error));
    expect(statusResponse).toMatchObject({
      ok: true,
      result: snapshot
    });
    await expect(command(port, APP_CONTEXT, "lark.auth.login.begin", {})).resolves.toMatchObject({
      ok: true,
      result: login
    });
    await expect(command(port, APP_CONTEXT, "lark.app.configuration.save", {
      appId: "cli_test123",
      appSecret: "secret-value-123",
      brand: "feishu"
    })).resolves.toMatchObject({ ok: true, result: snapshot });
    expect(status).toHaveBeenCalledOnce();
    expect(beginLogin).toHaveBeenCalledOnce();
    expect(configureApplication).toHaveBeenCalledWith({
      appId: "cli_test123",
      appSecret: "secret-value-123",
      brand: "feishu"
    });
    expect(runtimeLoader).not.toHaveBeenCalled();

    await server.shutdown();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});

async function command<T extends AgentCommandType>(
  port: FakePort,
  context: ProtocolContext,
  type: T,
  payload: CommandPayloads[T]
): Promise<ResponseEnvelope<T>> {
  const request = commandEnvelopeForContext(type, payload, context, 7);
  port.emit(request);
  let response: ResponseEnvelope<T> | undefined;
  await vi.waitFor(() => {
    const candidate = port.sent.find((value) => (
      isResponseEnvelope(value) && value.requestId === request.requestId
    ));
    expect(candidate).toBeDefined();
    response = candidate as ResponseEnvelope<T>;
  });
  if (!response) throw new Error("Expected a correlated Host response.");
  return response;
}
