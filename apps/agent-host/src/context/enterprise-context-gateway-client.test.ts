import { afterEach, describe, expect, it, vi } from "vitest";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EnterpriseContextGatewayClient", () => {
  it("implements the device authorization, project and Workspace binding contracts", async () => {
    const expiresAt = "2026-09-01T10:00:00Z";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.endsWith("/device-authorizations")) return response({
        authorizationId: "device-1",
        deviceSecret: "a".repeat(64),
        verificationUri: "https://datahub.example.test/agent?section=device-authorization",
        userCode: "A1B2C3D4",
        expiresAt,
        intervalSeconds: 5
      });
      if (url.endsWith("/device-authorizations/device-1/exchange")) return response({
        state: "signed-in",
        accessToken: "agent-access-token",
        accountId: "account-1",
        userId: "user-1",
        displayName: "Employee 67",
        expiresAt
      });
      if (url.endsWith("/projects")) return response({
        items: [{
          id: "project-1",
          accountId: "account-1",
          name: "Desktop",
          slug: "desktop",
          status: "active",
          bindingCount: 1,
          candidateCount: 2,
          sharedAssetCount: 3,
          updatedAt: expiresAt
        }],
        total: 1
      });
      if (url.endsWith("/projects/project-1/bindings")) return response(binding(expiresAt));
      if (url.includes("/workspace-bindings/current")) return response(binding(expiresAt));
      if (url.endsWith("/candidates")) return response({
        id: "candidate-remote-1",
        status: "candidate",
        createdAt: expiresAt,
        updatedAt: expiresAt
      });
      if (url.endsWith("/shared-experiences/search")) return response({
        items: [{
          id: "shared-1",
          projectId: "project-1",
          title: "Host recovery",
          taskType: "electron-recovery",
          summary: "Discard stale Host epochs.",
          score: 0.91,
          applicableWhen: ["Host epoch changes"],
          notApplicableWhen: ["Ordinary render"],
          externalRevision: "e".repeat(64),
          publishedAt: expiresAt
        }],
        total: 1
      });
      if (url.includes("/shared-experiences/shared-1?")) return response({
        id: "shared-1",
        projectId: "project-1",
        title: "Host recovery",
        taskType: "electron-recovery",
        problem: "Old events remain visible",
        strategy: "Discard stale epochs",
        result: "success",
        confidence: 0.9,
        sensitivity: "team",
        applicableWhen: ["Host epoch changes"],
        notApplicableWhen: ["Ordinary render"],
        evidence: [{
          kind: "test",
          label: "42 tests passed",
          hash: "d".repeat(64),
          verifiedAt: expiresAt
        }],
        externalRevision: "e".repeat(64),
        publishedAt: expiresAt
      });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const anonymous = new EnterpriseContextGatewayClient("https://datahub.example.test");
    const authorization = await anonymous.startDeviceAuthorization();
    expect(authorization.deviceSecret).toBe("a".repeat(64));
    const exchange = await anonymous.exchangeDeviceAuthorization("device-1", authorization.deviceSecret);
    expect(exchange).toMatchObject({
      state: "signed-in",
      credential: { endpoint: "https://datahub.example.test", accessToken: "agent-access-token" }
    });

    const authenticated = new EnterpriseContextGatewayClient(
      "https://datahub.example.test",
      "agent-access-token"
    );
    await expect(authenticated.listProjects()).resolves.toEqual([
      expect.objectContaining({ id: "project-1", updatedAt: Date.parse(expiresAt) })
    ]);
    await expect(authenticated.bindWorkspace("project-1", "f".repeat(64), "bind-1"))
      .resolves.toMatchObject({ enterpriseProjectId: "project-1" });
    await expect(authenticated.getWorkspaceBinding("f".repeat(64)))
      .resolves.toMatchObject({ enterpriseProjectName: "Desktop" });
    await expect(authenticated.createExperienceCandidate({
      idempotencyKey: "submit-1",
      projectId: "project-1",
      workspaceFingerprint: "f".repeat(64),
      sourceSessionIdHash: "e".repeat(64),
      candidateKind: "experience",
      taskType: "electron-recovery",
      title: "Host recovery",
      problem: "Old events remain visible",
      strategy: "Discard stale epochs",
      result: "success",
      confidence: 0.9,
      sensitivity: "team",
      applicableWhen: ["Host epoch changes"],
      notApplicableWhen: ["Ordinary render"],
      evidence: [{
        kind: "test",
        label: "42 tests passed",
        hash: "d".repeat(64),
        verifiedAt: expiresAt
      }],
      redactionStatus: "passed"
    })).resolves.toEqual({
      id: "candidate-remote-1",
      status: "candidate",
      createdAt: Date.parse(expiresAt),
      updatedAt: Date.parse(expiresAt)
    });
    await expect(authenticated.searchSharedExperiences("f".repeat(64), "host recovery", 2))
      .resolves.toEqual([expect.objectContaining({
        id: "shared-1",
        score: 0.91,
        publishedAt: Date.parse(expiresAt)
      })]);
    await expect(authenticated.getSharedExperience("f".repeat(64), "shared-1"))
      .resolves.toEqual(expect.objectContaining({
        id: "shared-1",
        strategy: "Discard stale epochs",
        evidence: [expect.objectContaining({ reference: `sha256:${"d".repeat(64)}` })]
      }));

    for (const [input, init] of fetchMock.mock.calls) {
      const url = requestUrl(input);
      const authorizationHeader = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/projects") || url.includes("/bindings") || url.includes("workspace-bindings") || url.endsWith("/candidates") || url.includes("shared-experiences")) {
        expect(authorizationHeader).toBe("Bearer agent-access-token");
      } else {
        expect(authorizationHeader).toBeNull();
      }
    }
  });

  it("rejects insecure verification links and malformed Gateway data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      authorizationId: "device-1",
      deviceSecret: "a".repeat(64),
      verificationUri: "http://not-loopback.example.test/authorize",
      userCode: "A1B2C3D4",
      expiresAt: "2026-09-01T10:00:00Z",
      intervalSeconds: 5
    })));

    await expect(new EnterpriseContextGatewayClient("https://datahub.example.test")
      .startDeviceAuthorization()).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    vi.stubGlobal("fetch", vi.fn(async () => response({
      authorizationId: "device-1",
      deviceSecret: "not-a-server-secret",
      verificationUri: "https://datahub.example.test/authorize",
      userCode: "A1B2C3D4",
      expiresAt: "2026-09-01T10:00:00Z",
      intervalSeconds: 5
    })));
    await expect(new EnterpriseContextGatewayClient("https://datahub.example.test")
      .startDeviceAuthorization()).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});

function binding(boundAt: string) {
  return {
    state: "bound",
    workspaceId: "binding-1",
    enterpriseProjectId: "project-1",
    enterpriseProjectName: "Desktop",
    accountId: "account-1",
    boundAt
  };
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
