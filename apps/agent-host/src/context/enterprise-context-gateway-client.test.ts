import { afterEach, describe, expect, it, vi } from "vitest";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { isRuntimeError } from "@pi67/domain";

const endpoint = "https://newmoney.example.test";
const teamId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const expiresAt = "2026-09-08T10:00:00Z";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EnterpriseContextGatewayClient", () => {
  it.each([undefined, false, true])("maps the server quota exemption %s without inferring from team name or plan", async (quotasExempt) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ teams: [{
      id: teamId, name: "sixseven", role: "owner", entitlementStatus: "active",
      planCode: "team-internal", maxMembers: 5, memberCount: 6, projectCount: 0,
      ...(quotasExempt === undefined ? {} : { quotasExempt })
    }] })));
    await expect(new EnterpriseContextGatewayClient(endpoint).listTeams()).resolves.toEqual([
      expect.objectContaining({ quotasExempt: quotasExempt ?? false, maxMembers: 5, memberCount: 6 })
    ]);
  });

  it.each([null, "true", "false", 1, 0, {}, []])("rejects malformed quota exemption %j", async (quotasExempt) => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ teams: [{
      id: teamId, name: "sixseven", role: "owner", entitlementStatus: "active",
      planCode: "team-internal", maxMembers: 5, memberCount: 1, projectCount: 0, quotasExempt
    }] })));
    await expect(new EnterpriseContextGatewayClient(endpoint).listTeams())
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD", recoverable: false });
  });

  it.each([400, 401, 403, 404, 408, 429, 500, 503])("classifies HTTP %s before reading an error body", async (status) => {
    const result = response({}, status);
    const body = vi.spyOn(result, "text").mockRejectedValue(new Error("body unavailable"));
    vi.stubGlobal("fetch", vi.fn(async () => result));
    const error = await new EnterpriseContextGatewayClient(endpoint).listTeams().catch((value: unknown) => value);
    const temporary = status >= 500 || status === 408 || status === 429;
    expect(error).toMatchObject({ code: "RUNTIME_NOT_READY", recoverable: temporary });
    expect(isRuntimeError(error) && error.details?.kind === "enterprise-transport-unavailable").toBe(temporary);
    expect(body).not.toHaveBeenCalled();
  });

  it("marks network failures temporary but rejects malformed successful responses without grace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fixture transport failure"); }));
    const client = new EnterpriseContextGatewayClient(endpoint);
    await expect(client.listTeams()).rejects.toMatchObject({ code: "RUNTIME_NOT_READY", details: { kind: "enterprise-transport-unavailable" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{malformed", { status: 200 })));
    await expect(client.listTeams()).rejects.toMatchObject({ code: "INVALID_PAYLOAD", recoverable: false });
  });

  it.each(["experience", "sop"] as const)("rejects inactive, revoked, missing-state and wrong-kind %s in search and detail", async (kind) => {
    const client = new EnterpriseContextGatewayClient(endpoint, "fixture-token");
    for (const patch of [{ status: "revoked" }, { status: "archived" }, { status: undefined },
      { revokedAt: expiresAt }, { revokedAt: "" }, { revokedAt: undefined },
      { kind: kind === "sop" ? "experience" : "sop" }, { kind: undefined }]) {
      const value = { ...asset(kind), ...patch };
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
        response(requestUrl(input).endsWith("/search") ? { results: [value] } : value)));
      const search = kind === "sop" ? client.searchSharedSops(teamId, projectId, "fixture")
        : client.searchSharedExperiences(teamId, projectId, "fixture", 2);
      await expect(search).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
      const detail = kind === "sop" ? client.getSharedSop(teamId, "sop-1") : client.getSharedExperience(teamId, "shared-1");
      await expect(detail).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
  });

  it("rejects expired SOPs at the deadline but accepts future and explicitly unbounded expiry", async () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const client = new EnterpriseContextGatewayClient(endpoint, "fixture-token");
    for (const expiry of [new Date(now - 1).toISOString(), new Date(now).toISOString(), "invalid",
      new Date(now + 1).toISOString(), null, undefined]) {
      const value = asset("sop");
      const payload = { ...value, content: { ...value.content, expiresAt: expiry } };
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
        response(requestUrl(input).endsWith("/search") ? { results: [payload] } : payload)));
      const accepted = expiry == null || Date.parse(expiry) > now;
      for (const read of [() => client.searchSharedSops(teamId, projectId, "fixture"), () => client.getSharedSop(teamId, "sop-1")]) {
        if (accepted) await expect(read()).resolves.toBeDefined();
        else await expect(read()).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
      }
    }
  });

  it("maps New Money device, team, project and Workspace contracts without exposing credentials", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.endsWith("/device-authorizations")) return response({
        authorizationId: "33333333-3333-4333-8333-333333333333",
        deviceCode: "a".repeat(64),
        verificationUri: `${endpoint}/device`,
        userCode: "A1B2-C3D4",
        expiresAt,
        intervalSeconds: 3
      });
      if (url.endsWith("/exchange")) return response(session());
      if (url.endsWith("/v1/auth/sessions/refresh")) return response({
        ...session(),
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token"
      });
      if (url.endsWith("/v1/auth/sessions/current")) return new Response(null, { status: 204 });
      if (url.endsWith("/teams") && init?.method === "GET") return response({ teams: [{
        id: teamId,
        name: "Product",
        slug: "product",
        role: "owner",
        entitlementStatus: "trialing",
        planCode: "team-trial",
        trialEndsAt: expiresAt,
        maxMembers: 5,
        memberCount: 1,
        projectCount: 1
      }] });
      if (url.endsWith(`/teams/${teamId}/projects`)) return response({ projects: [{
        id: projectId,
        teamId,
        name: "Desktop",
        description: "",
        status: "active",
        createdAt: expiresAt,
        updatedAt: expiresAt
      }] });
      if (url.includes("/workspace-bindings/current")) return response({
        teamId,
        workspaceId: "f".repeat(64),
        projectId,
        projectName: "Desktop",
        updatedAt: expiresAt
      });
      if (url.endsWith(`/teams/${teamId}/candidates`)) return response({
        id: "44444444-4444-4444-8444-444444444444",
        teamId,
        projectId,
        kind: "experience",
        title: "Host recovery",
        summary: "Discard stale epochs",
        status: "pending",
        submittedBy: "55555555-5555-4555-8555-555555555555",
        createdAt: expiresAt
      });
      if (url.endsWith("/shared-assets/search")) {
        const requestBody = init?.body;
        if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
        const body = JSON.parse(requestBody) as { kind: string };
        return response({ results: [asset(body.kind)] });
      }
      if (url.endsWith("/shared-assets/shared-1")) return response(asset("experience"));
      if (url.endsWith("/shared-assets/sop-1")) return response(asset("sop"));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const anonymous = new EnterpriseContextGatewayClient(endpoint);
    const authorization = await anonymous.startDeviceAuthorization();
    expect(authorization.deviceSecret).toBe("a".repeat(64));
    await expect(anonymous.exchangeDeviceAuthorization(
      "33333333-3333-4333-8333-333333333333",
      authorization.deviceSecret
    )).resolves.toMatchObject({
      state: "signed-in",
      credential: {
        endpoint,
        accessToken: "agent-access-token",
        refreshToken: "refresh-token",
        accountId: teamId
      }
    });
    await expect(anonymous.refreshCredential("refresh-token")).resolves.toMatchObject({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token"
    });

    const authenticated = new EnterpriseContextGatewayClient(endpoint, "agent-access-token");
    await expect(authenticated.listTeams()).resolves.toEqual([
      expect.objectContaining({ id: teamId, role: "owner", maxMembers: 5 })
    ]);
    await expect(authenticated.listProjects(teamId)).resolves.toEqual([
      expect.objectContaining({ id: projectId, accountId: teamId, updatedAt: Date.parse(expiresAt) })
    ]);
    await expect(authenticated.bindWorkspace(teamId, projectId, "f".repeat(64), "bind-1"))
      .resolves.toMatchObject({ enterpriseProjectId: projectId, accountId: teamId });
    await expect(authenticated.getWorkspaceBinding(teamId, "f".repeat(64)))
      .resolves.toMatchObject({ enterpriseProjectName: "Desktop" });
    await expect(authenticated.createExperienceCandidate(teamId, candidate()))
      .resolves.toEqual({
        id: "44444444-4444-4444-8444-444444444444",
        status: "candidate",
        createdAt: Date.parse(expiresAt),
        updatedAt: Date.parse(expiresAt)
      });
    await expect(authenticated.searchSharedExperiences(teamId, projectId, "host recovery", 2))
      .resolves.toEqual([expect.objectContaining({ id: "shared-1", score: 0.91 })]);
    await expect(authenticated.getSharedExperience(teamId, "shared-1"))
      .resolves.toEqual(expect.objectContaining({
        strategy: "Discard stale epochs",
        evidence: [expect.objectContaining({ reference: `sha256:${"d".repeat(64)}` })]
      }));
    await expect(authenticated.searchSharedSops(teamId, projectId, "host recovery"))
      .resolves.toEqual([expect.objectContaining({ id: "sop-1", stableKey: "host-epoch-recovery" })]);
    await expect(authenticated.getSharedSop(teamId, "sop-1"))
      .resolves.toEqual(expect.objectContaining({ id: "sop-1", method: method() }));
    await expect(authenticated.revokeSession()).resolves.toBeUndefined();

    for (const [input, init] of fetchMock.mock.calls) {
      const url = requestUrl(input);
      const header = new Headers(init?.headers).get("Authorization");
      if (url.includes("/teams/") || url.endsWith("/teams") || url.endsWith("/sessions/current")) {
        expect(header).toBe("Bearer agent-access-token");
      } else {
        expect(header).toBeNull();
      }
    }
  });

  it("treats New Money 428 device exchange as pending", async () => {
    const pending = response({ code: "authorization_pending" }, 428);
    const cancel = vi.spyOn(pending.body!, "cancel");
    vi.stubGlobal("fetch", vi.fn(async () => pending));
    await expect(new EnterpriseContextGatewayClient(endpoint).exchangeDeviceAuthorization(
      "33333333-3333-4333-8333-333333333333",
      "a".repeat(64)
    )).resolves.toEqual({ state: "pending" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects insecure verification links and malformed device data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      authorizationId: "33333333-3333-4333-8333-333333333333",
      deviceCode: "not-a-server-secret",
      verificationUri: "http://not-loopback.example.test/device",
      userCode: "A1B2-C3D4",
      expiresAt,
      intervalSeconds: 3
    })));
    await expect(new EnterpriseContextGatewayClient(endpoint).startDeviceAuthorization())
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });
});

function session() {
  return {
    accessToken: "agent-access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    expiresAt,
    user: {
      id: "55555555-5555-4555-8555-555555555555",
      email: "person@example.test",
      displayName: "Employee 67"
    },
    activeTeamId: teamId
  };
}

function candidate() {
  return {
    idempotencyKey: "submit-1",
    projectId,
    workspaceFingerprint: "f".repeat(64),
    sourceSessionIdHash: "e".repeat(64),
    candidateKind: "experience" as const,
    taskType: "electron-recovery",
    title: "Host recovery",
    problem: "Old events remain visible",
    strategy: "Discard stale epochs",
    method: method(),
    result: "success" as const,
    confidence: 0.9,
    sensitivity: "team" as const,
    applicableWhen: ["Host epoch changes"],
    notApplicableWhen: ["Ordinary render"],
    evidence: [{
      kind: "test" as const,
      label: "42 tests passed",
      hash: "d".repeat(64),
      verifiedAt: expiresAt
    }],
    redactionStatus: "passed" as const
  };
}

function asset(kind: string) {
  const content = kind === "sop" ? {
    stableKey: "host-epoch-recovery",
    semanticVersion: 2,
    ownerUserIdHash: "f".repeat(64),
    title: "Host recovery SOP",
    taskType: "electron-recovery",
    problem: "Old events remain visible",
    strategy: "Discard stale epochs",
    method: method(),
    confidence: 0.94,
    sensitivity: "team",
    applicableWhen: ["Host epoch changes"],
    notApplicableWhen: ["Ordinary render"],
    evidence: [{ kind: "test", label: "42 tests passed", hash: "d".repeat(64), verifiedAt: expiresAt }],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString()
  } : candidate();
  return {
    id: kind === "sop" ? "sop-1" : "shared-1",
    teamId,
    projectId,
    kind,
    title: kind === "sop" ? "Host recovery SOP" : "Host recovery",
    summary: kind === "sop" ? "Apply the governed workflow." : "Discard stale Host epochs.",
    status: "active",
    publishedAt: expiresAt,
    revokedAt: null,
    content,
    externalRevision: "e".repeat(64),
    score: kind === "sop" ? 0.95 : 0.91
  };
}

function method() {
  return {
    preconditions: ["The Host epoch changed"],
    steps: ["Discard stale events"],
    tools: ["packaged smoke"],
    validationGates: ["No stale Projection remains"],
    completionCriteria: ["The active Session resumes"],
    failureModes: ["An old approval remains visible"],
    rollback: "Restore the previous Host build."
  };
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
