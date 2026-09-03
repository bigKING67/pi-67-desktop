import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isContextMemoryAppCommand,
  isContextMemoryWorkspaceCommand
} from "./context-memory-command-router.js";
import {
  cleanupRouterFixtures,
  createRouter,
  enterpriseFetch,
  healthyFetch,
  workspaceContext,
  workspaceMemoryUri
} from "./context-memory-command-router.test-support.js";

afterEach(cleanupRouterFixtures);
describe("ContextMemoryCommandRouter", () => {
  it("serves app configuration, health, doctor and truthful enterprise-disabled states", async () => {
    vi.stubGlobal("fetch", healthyFetch());
    const fixture = await createRouter();
    const configuration = await fixture.router.dispatchApp({ type: "context.config.get", payload: {} });
    if (!("revision" in configuration)) throw new Error("Expected Context configuration");

    await expect(fixture.router.dispatchApp({ type: "context.status.get", payload: {} }))
      .resolves.toMatchObject({ health: "healthy", owner: "pi67-openviking", version: "0.4.16" });
    await expect(fixture.router.dispatchApp({ type: "context.runtime.doctor", payload: { probeRemote: false } }))
      .resolves.toMatchObject({
        status: { health: "degraded" },
        checks: [
          { id: "effective-config", status: "pass" },
          { id: "memory-owner-installation", status: "pass" },
          { id: "memory-owner-preflight", status: "pass" },
          { id: "memory-owner-load-receipt", status: "warn" },
          { id: "openviking-health", status: "warn" }
        ]
      });
    await expect(fixture.router.dispatchApp({ type: "enterprise.identity.get", payload: {} }))
      .resolves.toEqual({ state: "signed-out" });
    await expect(fixture.router.dispatchApp({ type: "enterprise.auth.poll", payload: { authorizationId: "pending" } }))
      .resolves.toEqual({ state: "signed-out" });
    await expect(fixture.router.dispatchApp({ type: "enterprise.auth.begin", payload: {} }))
      .rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(fixture.router.dispatchApp({ type: "enterprise.auth.disconnect", payload: {} }))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await expect(fixture.router.dispatchApp(
      { type: "enterprise.auth.disconnect", payload: {} },
      "disconnect-1"
    )).resolves.toEqual({ state: "signed-out" });
    await expect(fixture.router.dispatchApp(
      { type: "enterprise.auth.disconnect", payload: {} },
      "disconnect-1"
    )).resolves.toEqual({ state: "signed-out" });

    const update = {
      expectedRevision: configuration.revision,
      enabled: true,
      endpoint: configuration.endpoint,
      enterpriseGatewayEndpoint: configuration.enterpriseGatewayEndpoint,
      defaultPrivacyMode: "full-learning" as const,
      recallTokenBudget: 3_000,
      scoreThreshold: 0.4,
      commitTokenThreshold: 21_000,
      captureAssistantTurns: true,
      privateExperienceLimit: 1,
      localResourceRecallLimit: 1,
      sharedExperienceLimit: 2,
      takeover: { enabled: true, tokenThreshold: 31_000, keepRecentTurns: 3 }
    };
    await expect(fixture.router.dispatchApp(
      { type: "context.config.update", payload: update },
      "config-update-1"
    )).resolves.toMatchObject({ defaultPrivacyMode: "full-learning", actorScopeOnly: true });
    await expect(fixture.router.dispatchApp(
      { type: "context.config.update", payload: update },
      "disconnect-1"
    )).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    expect(fixture.events.map((event) => event.type)).toEqual([
      "enterprise.authChanged",
      "context.configChanged"
    ]);
  });

  it("routes private Session and memory operations without manufacturing enterprise data", async () => {
    const fetchMock = healthyFetch();
    vi.stubGlobal("fetch", fetchMock);
    const fixture = await createRouter();

    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.get",
      payload: { sessionId: "session/one" }
    })).resolves.toMatchObject({
      sessionId: "session/one",
      owner: "pi67-openviking",
      capturedTurns: 8,
      pendingTokens: 1_200,
      lastCommitAt: expect.any(Number)
    });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.search",
      payload: { query: "host recovery", scope: "workspace", limit: 10 }
    })).resolves.toMatchObject({ total: 1, items: [{ id: workspaceMemoryUri, scope: "workspace" }] });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.search",
      payload: { query: "shared", scope: "team" }
    })).resolves.toEqual({ items: [], total: 0 });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.get",
      payload: { id: workspaceMemoryUri }
    })).resolves.toMatchObject({ summary: "Host recovery memory", workspaceId: "workspace-1" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.get",
      payload: { id: "viking://resources/team/not-private" }
    })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const preview = await fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.forget.preview",
      payload: { id: workspaceMemoryUri }
    });
    if (!("previewToken" in preview)) throw new Error("Expected a forget preview");
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.forget.confirm",
      payload: { submissionId: "forget-1", previewToken: "missing" }
    }, "forget-missing")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "memory.forget.confirm",
      payload: { submissionId: "forget-1", previewToken: preview.previewToken }
    }, "forget-1")).resolves.toMatchObject({ kind: "accepted", operationId: expect.any(String) });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.commit",
      payload: { submissionId: "commit-1", sessionId: "session/one" }
    }, "commit-1")).resolves.toMatchObject({ kind: "accepted" });

    await expect(fixture.router.dispatchWorkspace(workspaceContext, { type: "context.recall.list", payload: {} }))
      .resolves.toEqual({ items: [], total: 0 });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, { type: "experience.private.list", payload: {} }))
      .resolves.toEqual({ items: [], total: 0 });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, { type: "experience.shared.search", payload: { query: "recovery" } }))
      .rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, { type: "sop.shared.search", payload: { query: "recovery" } }))
      .rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, { type: "experience.candidate.get", payload: { id: "missing" } }))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.candidate.promote",
      payload: { submissionId: "promote", id: "missing" }
    }, "promote-missing")).resolves.toMatchObject({ kind: "accepted" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.candidate.reject",
      payload: { id: "missing", reason: "invalid" }
    }, "reject-missing")).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    await expect(fixture.router.dispatchWorkspace(workspaceContext, { type: "enterprise.workspace.get", payload: {} }))
      .resolves.toEqual({ state: "unbound", workspaceId: "workspace-1" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "enterprise.workspace.bind",
      payload: { enterpriseProjectId: "project-1" }
    }, "bind-signed-out")).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "enterprise.workspace.unbind",
      payload: {}
    }, "unbind-1")).rejects.toMatchObject({ code: "UNSUPPORTED" });

    await fixture.router.shutdown();
    expect(fixture.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "memory.forgetCompleted",
      "context.commitCompleted",
      "experience.candidatePromotionFailed"
    ]));
    const actorHeader = fetchMock.mock.calls
      .map(([, init]) => new Headers(init?.headers).get("X-OpenViking-Actor-Peer"))
      .find(Boolean);
    expect(actorHeader).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps device credentials in the Host and binds a trusted Workspace through the Gateway", async () => {
    const endpoint = "https://datahub.example.test";
    const expiresAt = Date.now() + 10 * 60_000;
    const fetchMock = enterpriseFetch(expiresAt);
    vi.stubGlobal("fetch", fetchMock);
    const fixture = await createRouter(
      { enterpriseGatewayEndpoint: endpoint },
      { secureStorage: "available", workspaceTrusted: true }
    );

    const authorization = await fixture.router.dispatchApp({
      type: "enterprise.auth.begin",
      payload: {}
    });
    if (!("authorizationId" in authorization)) throw new Error("Expected enterprise device authorization");
    expect(authorization).toMatchObject({
      authorizationId: "device-1",
      verificationUri: "https://datahub.example.test/agent?section=device-authorization",
      userCode: "A1B2C3D4"
    });
    expect(authorization).not.toHaveProperty("deviceSecret");

    await expect(fixture.router.dispatchApp({
      type: "enterprise.auth.poll",
      payload: { authorizationId: authorization.authorizationId }
    })).resolves.toEqual({ state: "pending", expiresAt: authorization.expiresAt });
    await expect(fixture.router.dispatchApp({
      type: "enterprise.auth.poll",
      payload: { authorizationId: authorization.authorizationId }
    })).resolves.toEqual({
      state: "signed-in",
      accountId: "account-1",
      userId: "user-1",
      displayName: "Employee 67",
      expiresAt
    });

    const projects = await fixture.router.dispatchApp({ type: "enterprise.project.list", payload: {} });
    expect(projects).toEqual({
      total: 1,
      items: [expect.objectContaining({ id: "project-1", accountId: "account-1", status: "active" })]
    });
    expect(projects).not.toHaveProperty("accessToken");

    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "enterprise.workspace.get",
      payload: {}
    })).resolves.toEqual({ state: "unbound", workspaceId: "workspace-1" });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "enterprise.workspace.bind",
      payload: { enterpriseProjectId: "project-1" }
    }, "bind-1")).resolves.toEqual({
      state: "bound",
      workspaceId: "workspace-1",
      enterpriseProjectId: "project-1",
      enterpriseProjectName: "Desktop",
      accountId: "account-1",
      boundAt: expect.any(Number)
    });

    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.shared.search",
      payload: { query: "host recovery", limit: 2 }
    })).resolves.toEqual({
      total: 1,
      items: [expect.objectContaining({
        id: "shared-1",
        projectId: "project-1",
        title: "Host recovery",
        score: 0.91
      })]
    });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "experience.shared.get",
      payload: { id: "shared-1" }
    })).resolves.toEqual(expect.objectContaining({
      id: "shared-1",
      projectId: "project-1",
      strategy: "Discard stale epochs",
      evidence: [expect.objectContaining({ reference: `sha256:${"d".repeat(64)}` })]
    }));
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "sop.shared.search",
      payload: { query: "standard host recovery" }
    })).resolves.toEqual({
      total: 1,
      items: [expect.objectContaining({
        id: "sop-1",
        projectId: "project-1",
        stableKey: "host-epoch-recovery",
        semanticVersion: 2
      })]
    });
    await expect(fixture.router.dispatchWorkspace(workspaceContext, {
      type: "sop.shared.get",
      payload: { id: "sop-1" }
    })).resolves.toEqual(expect.objectContaining({
      id: "sop-1",
      projectId: "project-1",
      method: expect.objectContaining({ steps: ["Discard stale events"] })
    }));

    const authenticatedRequests = fetchMock.mock.calls.filter(([, init]) =>
      new Headers(init?.headers).has("Authorization")
    );
    expect(authenticatedRequests).toHaveLength(7);
    for (const [, init] of authenticatedRequests) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer agent-access-token");
    }
    expect(fixture.credentialSnapshot()).toMatchObject({
      storage: "available",
      credential: { accessToken: "agent-access-token" }
    });
    expect(fixture.events.map((event) => event.type)).toEqual([
      "enterprise.authChanged",
      "enterprise.authChanged",
      "enterprise.workspaceBindingChanged"
    ]);
  });

  it("fails memory closed on disabled, conflicting and unavailable runtimes", async () => {
    const disabled = await createRouter({ enabled: false });
    await expect(disabled.router.dispatchApp({ type: "context.status.get", payload: {} }))
      .resolves.toMatchObject({ health: "disabled", owner: "pi-default-compaction" });
    await expect(disabled.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.get",
      payload: { sessionId: "disabled" }
    })).resolves.toMatchObject({ owner: "pi-default-compaction", takeoverActive: false });
    await expect(disabled.router.dispatchWorkspace(workspaceContext, {
      type: "context.session.commit",
      payload: { submissionId: "disabled", sessionId: "disabled" }
    }, "disabled-commit")).resolves.toMatchObject({ kind: "accepted" });
    await disabled.router.shutdown();
    expect(disabled.events.some((event) => event.type === "context.commitFailed")).toBe(true);

    const conflict = await createRouter();
    for (const owner of ["pi67-openviking", "openviking-copy"]) {
      await mkdir(join(conflict.root, "extensions", owner), { recursive: true });
      await writeFile(
        join(conflict.root, "extensions", owner, "index.ts"),
        "export default function openVikingOwner() {}\n",
        "utf8"
      );
    }
    await expect(conflict.router.dispatchApp({ type: "context.status.get", payload: {} }))
      .resolves.toMatchObject({
        health: "conflict",
        owner: "pi-default-compaction",
        conflictExtensions: ["openviking-copy", "pi67-openviking"],
        detail: expect.stringContaining("Pi default Compaction remains available")
      });
    await expect(conflict.router.dispatchApp({ type: "context.runtime.doctor", payload: {} }))
      .resolves.toMatchObject({ checks: expect.arrayContaining([
        { id: "memory-owner-installation", status: "pass", detail: expect.stringContaining("Installed owner directories") },
        { id: "memory-owner-preflight", status: "fail", detail: expect.stringContaining("Startup gate") }
      ]) });

    vi.stubGlobal("fetch", vi.fn(async () => { throw "offline"; }));
    const unavailable = await createRouter();
    await expect(unavailable.router.dispatchApp({ type: "context.status.get", payload: {} }))
      .resolves.toMatchObject({ health: "unavailable", detail: "OpenViking is unavailable." });
  });

  it("classifies only the registered app and Workspace command surfaces", () => {
    expect(isContextMemoryAppCommand("context.status.get")).toBe(true);
    expect(isContextMemoryAppCommand("context.session.get")).toBe(false);
    expect(isContextMemoryWorkspaceCommand("memory.search")).toBe(true);
    expect(isContextMemoryWorkspaceCommand("runtime.getStatus")).toBe(false);
  });
});
