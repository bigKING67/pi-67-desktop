import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { enterprisePowerEpoch } from "./enterprise-power-epoch.js";

const workspaceId = "workspace", teamId = "team", projectId = "project";
const binding = { state: "bound" as const, workspaceId, accountId: teamId,
  enterpriseProjectId: projectId, enterpriseProjectName: "Project", boundAt: 1 };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());

function fixture(recall?: unknown) {
  const gateway = EnterpriseContextGatewayClient.prototype;
  vi.spyOn(gateway, "authorizeProject").mockResolvedValue({ permissionRevision: "a".repeat(64), deadline: Date.now() + 60_000, assertValid() {}, assertModel() { throw new Error("model denied"); }, assertAgentModel() { throw new Error("model denied"); } });
  vi.spyOn(gateway, "getWorkspaceBinding").mockResolvedValue({} as never);
  vi.spyOn(gateway, "bindWorkspace").mockResolvedValue({} as never);
  vi.spyOn(gateway, "toDesktopBinding").mockImplementation(() => ({ ...binding }));
  vi.spyOn(gateway, "startDeviceAuthorization").mockResolvedValue({
    authorizationId: "new-auth", deviceSecret: "synthetic", expiresAt: Date.now() + 60_000,
    verificationUri: "https://fixture.invalid/verify", userCode: "fixture", intervalSeconds: 1
  });
  vi.spyOn(gateway, "revokeSession").mockResolvedValue(undefined);
  const broker = new EnterpriseCredentialBrokerClient({ postMessage(message) {
    queueMicrotask(() => broker.handleOperationResult({
      type: "enterprise-credential-operation-result", requestId: message.requestId, ok: true
    }));
  } });
  broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available",
    credential: { endpoint: "https://fixture.invalid", accountId: teamId, userId: "user",
      accessToken: "synthetic", expiresAt: Date.now() + 60_000 } });
  const controller = new EnterpriseContextController(
    { read: async () => ({ enterpriseGatewayEndpoint: "https://fixture.invalid", sharedExperienceLimit: 2 }) } as never,
    { require: () => ({ initialization: { trust: "trusted" } }) } as never,
    { sendFor() {} } as never, broker, recall as never
  );
  return { controller, gateway };
}

const operations = ["searchSharedExperiences", "getSharedExperience", "searchSharedSops", "getSharedSop"] as const;
it.each(operations)("reads %s from birth scope without reading or modifying Workspace binding", async (operation) => {
  const { controller, gateway } = fixture();
  const scope = { userId: "user", teamId: "chosen-team", projectId: "chosen-project", endpoint: "https://fixture.invalid" };
  const model = { baseUrl: "https://model.fixture", id: "model", scope };
  const assertAgentModel = vi.fn(), assertValid = vi.fn();
  const authorize = vi.spyOn(gateway, "authorizeProject").mockResolvedValue({ permissionRevision: "a".repeat(64),
    deadline: Date.now() + 60_000, assertValid, assertModel: vi.fn(), assertAgentModel });
  const getBinding = vi.spyOn(gateway, "getWorkspaceBinding").mockRejectedValue(new Error("Workspace is unbound"));
  const bind = vi.spyOn(gateway, "bindWorkspace");
  const transport = vi.spyOn(gateway, operation).mockResolvedValue((operation.startsWith("search") ? []
    : { projectId: scope.projectId, expiresAt: Date.now() + 60_000 }) as never);
  try {
    const result = operation === "searchSharedExperiences"
      ? controller.searchSharedExperiences(workspaceId, "query", 2, undefined, model)
      : controller[operation](workspaceId, "query-or-id", undefined, model);
    await expect(result).resolves.toBeDefined();
    expect(authorize).toHaveBeenCalledExactlyOnceWith("user", "chosen-team", "chosen-project", undefined);
    expect(assertAgentModel).toHaveBeenCalledWith(model);
    expect(assertValid).toHaveBeenCalled();
    expect(transport.mock.calls[0]?.[0]).toBe("chosen-team");
    expect(getBinding).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  } finally { controller.shutdown(); }
});

it.each(operations)("rejects birth-scoped %s after logout while transport is pending", async (operation) => {
  const { controller, gateway } = fixture();
  const entered = deferred(), release = deferred();
  vi.spyOn(gateway, "authorizeProject").mockResolvedValue({ permissionRevision: "a".repeat(64), deadline: Date.now() + 60_000,
    assertValid() {}, assertModel() {}, assertAgentModel() {} });
  vi.spyOn(gateway, operation).mockImplementation(async () => {
    entered.resolve(); await release.promise;
    return (operation.startsWith("search") ? [] : { projectId }) as never;
  });
  const model = { baseUrl: "https://model.fixture", id: "model", scope: { userId: "user", teamId, projectId, endpoint: "https://fixture.invalid" } };
  try {
    const pending = operation === "searchSharedExperiences" ? controller.searchSharedExperiences(workspaceId, "query", 2, undefined, model)
      : controller[operation](workspaceId, "id", undefined, model);
    const rejected = expect(pending).rejects.toThrow("identity or project changed");
    await entered.promise; await controller.disconnect(); release.resolve(); await rejected;
  } finally { release.resolve(); controller.shutdown(); }
});

it.each(operations)("rejects pending %s results across a native suspend/resume cycle", async (operation) => {
  const { controller, gateway } = fixture();
  const reached = deferred(), pause = deferred();
  vi.spyOn(gateway, operation).mockImplementation(async () => {
    reached.resolve(); await pause.promise;
    return (operation.startsWith("search") ? [] : { projectId }) as never;
  });
  try {
    const pending = operation === "searchSharedExperiences" ? controller.searchSharedExperiences(workspaceId, "fixture", 2)
      : controller[operation](workspaceId, "fixture");
    const rejected = expect(pending).rejects.toThrow("power transition");
    await reached.promise;
    enterprisePowerEpoch.transition("suspend"); enterprisePowerEpoch.transition("resume");
    pause.resolve(); await rejected;
  } finally { pause.resolve(); enterprisePowerEpoch.transition("resume"); controller.shutdown(); }
});
it("requires a fresh server grant after Host receives native power transitions", async () => {
  const { controller, gateway } = fixture();
  const authorize = vi.spyOn(gateway, "authorizeProject");
  try {
    const grant = await controller.authorizeTeamSession({ teamId, projectId });
    enterprisePowerEpoch.transition("suspend");
    expect(() => grant.assertValid()).toThrow("power transition");
    await expect(controller.authorizeTeamSession({ teamId, projectId })).rejects.toThrow("power transition");
    expect(authorize).toHaveBeenCalledOnce();
    enterprisePowerEpoch.transition("resume");
    expect(() => grant.assertValid()).toThrow("power transition");
    const resumed = await controller.authorizeTeamSession({ teamId, projectId }); resumed.assertValid();
    expect(authorize).toHaveBeenCalledTimes(2);
  } finally { enterprisePowerEpoch.transition("resume"); controller.shutdown(); }
});
it("checks the requested Agent model when authorizing team continuation, without requiring a Workspace binding", async () => {
  const { controller, gateway } = fixture();
  const model = { baseUrl: "https://model.fixture", id: "model" };
  try {
    await expect(controller.authorizeTeamSession({ teamId, projectId }, model)).rejects.toThrow("model denied");
    const assertAgentModel = vi.fn();
    const authorizeProject = vi.spyOn(gateway, "authorizeProject").mockResolvedValue({ permissionRevision: "a".repeat(64), deadline: Date.now() + 1000, assertValid() {}, assertModel: vi.fn(), assertAgentModel });
    const signal = new AbortController().signal;
    const grant = await controller.authorizeTeamSession({ teamId, projectId }, model, signal);
    expect(authorizeProject).toHaveBeenLastCalledWith("user", teamId, projectId, signal);
    grant.assertValid();
    expect(assertAgentModel).toHaveBeenCalledWith(model);
    await controller.disconnect();
    expect(grant.assertValid).toThrow("authorization changed");
  } finally { controller.shutdown(); }
});
it("rejects an SOP that expires while asynchronous observation is pending", async () => {
  const pause = deferred(), reached = deferred();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const { controller, gateway } = fixture({
    applyEnterpriseFeedback: async (_workspace: string, _route: string, items: unknown[]) => items,
    recordEnterprise: async () => { reached.resolve(); await pause.promise; }
  });
  vi.spyOn(gateway, "searchSharedSops").mockResolvedValue([{ id: "sop", projectId, expiresAt: now + 1 }] as never);
  try {
    const pending = controller.searchSharedSops(workspaceId, "fixture");
    const rejection = expect(pending).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await reached.promise;
    clock.mockReturnValue(now + 1);
    pause.resolve();
    await rejection;
  } finally { pause.resolve(); controller.shutdown(); }
});
it.each(operations)("rejects mismatched birth scope before %s content or project authorization", async (operation) => {
  const { controller, gateway } = fixture();
  const transport = vi.spyOn(gateway, operation), authorization = vi.spyOn(gateway, "authorizeProject");
  const model = { baseUrl: "https://model.fixture", id: "model", scope: {
    userId: "another-user", teamId, projectId, endpoint: "https://fixture.invalid" } };
  try {
    const result = operation === "searchSharedExperiences"
      ? controller.searchSharedExperiences(workspaceId, "query", 2, undefined, model)
      : controller[operation](workspaceId, "query-or-id", undefined, model);
    await expect(result).rejects.toThrow("team Session identity");
    expect(transport).not.toHaveBeenCalled();
    expect(authorization).not.toHaveBeenCalled();
  } finally { controller.shutdown(); }
});
it("authorizes the explicitly requested team project and binds grant lifetime to sign-in generation", async () => {
  const { controller, gateway } = fixture();
  const authorization = vi.spyOn(gateway, "authorizeProject"), workspaceBinding = vi.spyOn(gateway, "getWorkspaceBinding");
  try {
    const grant = await controller.authorizeTeamSession({ teamId: "requested-team", projectId: "requested-project" });
    expect(authorization).toHaveBeenCalledWith("user", "requested-team", "requested-project", undefined);
    expect(grant.identity).toEqual({ teamId: "requested-team", projectId: "requested-project", userId: "user", endpoint: "https://fixture.invalid" });
    expect(workspaceBinding).not.toHaveBeenCalled();
    await controller.disconnect();
    expect(grant.assertValid).toThrow("authorization changed");
  } finally { controller.shutdown(); }
});
it("does not issue a team birth grant when the server denies the requested scope", async () => {
  const { controller, gateway } = fixture();
  vi.spyOn(gateway, "authorizeProject").mockRejectedValue(new Error("scope denied"));
  try {
    await expect(controller.authorizeTeamSession({ teamId, projectId })).rejects.toThrow("scope denied");
  } finally { controller.shutdown(); }
});
it.each(operations)("denied model prevents %s content transport", async (operation) => {
  const { controller, gateway } = fixture();
  const transport = vi.spyOn(gateway, operation);
  try {
    const result = operation === "searchSharedExperiences"
      ? controller.searchSharedExperiences(workspaceId, "query", 2, undefined, null)
      : controller[operation](workspaceId, "query-or-id", undefined, null);
    await expect(result).rejects.toThrow("model denied");
    expect(transport).not.toHaveBeenCalled();
  } finally { controller.shutdown(); }
});
it.each(operations)("denied authorization prevents %s transport", async (operation) => {
  const { controller, gateway } = fixture();
  vi.spyOn(gateway, "authorizeProject").mockRejectedValue(new Error("authorization denied"));
  const transport = vi.spyOn(gateway, operation);
  try {
    await expect(controller[operation](workspaceId, "query-or-id")).rejects.toThrow("authorization denied");
    expect(transport).not.toHaveBeenCalled();
  } finally { controller.shutdown(); }
});
it.each(operations.flatMap((operation) => ["disconnect", "begin", "rebind", "shutdown"].map((action) => ({ operation, action }))))(
  "rejects late $operation after $action", async ({ operation, action }) => {
    const { controller, gateway } = fixture();
    const entered = deferred(), release = deferred();
    vi.spyOn(gateway, operation).mockImplementation(async () => {
      entered.resolve(); await release.promise;
      return (operation.startsWith("search") ? [] : { projectId }) as never;
    });
    try {
      await controller.getWorkspaceBinding(workspaceId, teamId);
      const result = controller[operation](workspaceId, "query-or-id");
      const rejected = expect(result).rejects.toThrow("identity or project changed");
      await entered.promise;
      if (action === "disconnect") await controller.disconnect();
      else if (action === "begin") await controller.beginAuthorization();
      else if (action === "rebind") await controller.bindWorkspace(workspaceId, teamId, "next-project", "request");
      else controller.shutdown();
      release.resolve();
      await rejected;
    } finally { release.resolve(); controller.shutdown(); }
  }
);

it("does not repopulate a binding cache after disconnect", async () => {
  const { controller, gateway } = fixture();
  const entered = deferred(), release = deferred();
  vi.spyOn(gateway, "getWorkspaceBinding").mockImplementation(async () => {
    entered.resolve(); await release.promise; return {} as never;
  });
  try {
    const pending = controller.getWorkspaceBinding(workspaceId, teamId);
    const rejected = expect(pending).rejects.toThrow("identity or project changed");
    await entered.promise;
    await controller.disconnect();
    release.resolve();
    await rejected;
    expect(await controller.getWorkspaceBinding(workspaceId, teamId)).toEqual({ state: "unbound", workspaceId });
  } finally { release.resolve(); controller.shutdown(); }
});

it.each(operations)("retains current-scope %s", async (operation) => {
  const { controller, gateway } = fixture();
  const payload = operation.startsWith("search") ? [] : { projectId };
  vi.spyOn(gateway, operation).mockResolvedValue(payload as never);
  try {
    await expect(controller[operation](workspaceId, "query-or-id")).resolves.toEqual(
      operation.startsWith("search") ? { items: [], total: 0 } : payload
    );
  } finally { controller.shutdown(); }
});

it.each(["feedback", "observation"])("rechecks scope after asynchronous %s", async (stage) => {
  const entered = deferred(), release = deferred();
  const pause = async () => { entered.resolve(); await release.promise; };
  const { controller, gateway } = fixture({
    applyEnterpriseFeedback: async () => { if (stage === "feedback") await pause(); return []; },
    recordEnterprise: async () => { if (stage === "observation") await pause(); }
  });
  vi.spyOn(gateway, "searchSharedExperiences").mockResolvedValue([]);
  try {
    const result = controller.searchSharedExperiences(workspaceId, "query");
    const rejected = expect(result).rejects.toThrow("identity or project changed");
    await entered.promise;
    await controller.disconnect();
    release.resolve();
    await rejected;
  } finally { release.resolve(); controller.shutdown(); }
});
