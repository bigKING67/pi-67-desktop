import { afterEach, expect, it, vi } from "vitest";
import { parseScopeAuthorization } from "./enterprise-scope-authorization.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
const expected = { userId: "user", teamId: "team", projectId: "project" };
function snapshot() {
  return { ...expected, role: "member", permissionRevision: "a".repeat(64),
    issuedAt: new Date(Date.now() - 1000).toISOString(), leaseExpiresAt: new Date(Date.now() + 59_000).toISOString(),
    modelPolicy: { teamId: "team", revision: "0", allowedModels: [] } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps team and project authorization distinct using the server's omitted projectId contract", () => {
  const { projectId: _projectId, ...team } = snapshot();
  const teamExpected = { ...expected, projectId: null };
  expect(() => parseScopeAuthorization(team, teamExpected, Date.now()).assertValid()).not.toThrow();
  expect(() => parseScopeAuthorization(team, expected, Date.now())).toThrow();
  for (const projectId of ["project", "other", null, undefined]) {
    expect(() => parseScopeAuthorization({ ...team, projectId }, teamExpected, Date.now())).toThrow();
  }
  expect(() => parseScopeAuthorization({ ...team, userId: "other" }, teamExpected, Date.now())).toThrow();
  expect(() => parseScopeAuthorization({ ...team, teamId: "other" }, teamExpected, Date.now())).toThrow();
});

it("fetches explicit team authorization through the authenticated gateway without a project fallback", async () => {
  const { projectId: _projectId, ...team } = snapshot();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(team), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new EnterpriseContextGatewayClient("https://fixture.invalid", "synthetic-token");
  const grant = await client.authorizeTeam(expected.userId, expected.teamId);
  expect(grant.permissionRevision).toBe(team.permissionRevision);
  expect(() => grant.assertAgentModel(null)).toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://fixture.invalid/v1/agent/teams/team/authorization");
  const init = fetcher.mock.calls[0]?.[1];
  expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
});

it("rejects project responses and denial for team requests without retrying another scope", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(snapshot()), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const client = new EnterpriseContextGatewayClient("https://fixture.invalid", "synthetic-token");
  await expect(client.authorizeTeam(expected.userId, expected.teamId)).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  fetcher.mockResolvedValueOnce(new Response("{}", { status: 403 }));
  await expect(client.authorizeTeam(expected.userId, expected.teamId)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not send a cancelled team authorization request", async () => {
  const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController(); controller.abort();
  await expect(new EnterpriseContextGatewayClient("https://fixture.invalid", "synthetic-token")
    .authorizeTeam(expected.userId, expected.teamId, controller.signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("never revives an expired lease when wall time moves backwards", () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const lease = parseScopeAuthorization(snapshot(), expected, Date.now());
  vi.setSystemTime(1_060_000);
  expect(lease.assertValid).toThrow();
  vi.setSystemTime(1_000_000);
  expect(lease.assertValid).toThrow();
});
it("invalidates a lease on observed wall-clock rollback even before expiry", () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const lease = parseScopeAuthorization(snapshot(), expected, Date.now());
  vi.setSystemTime(999_999);
  expect(lease.assertValid).toThrow();
  vi.setSystemTime(1_000_001);
  expect(lease.assertValid).toThrow();
});
it("expires by monotonic elapsed time even when wall time does not advance", () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const lease = parseScopeAuthorization(snapshot(), expected, Date.now(), 0);
  clock.mockReturnValue(59_000);
  expect(lease.assertValid).toThrow();
});
it("charges transport latency to the lease using the request-start monotonic clock", () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  vi.spyOn(performance, "now").mockReturnValue(61_000);
  expect(() => parseScopeAuthorization(snapshot(), expected, Date.now(), 0)).toThrow();
});
it("allows only the exact agent endpoint and model, never extraction or embedding grants", () => {
  const value = { ...snapshot(), modelPolicy: { teamId: "team", revision: "1", allowedModels: [
    { purpose: "agent", endpoint: "https://MODEL.fixture:443/v1", modelId: "approved" },
    { purpose: "extraction", endpoint: "https://model.fixture/v1", modelId: "extract" },
    { purpose: "embedding", endpoint: "https://model.fixture/v1", modelId: "embed" }
  ] } };
  const lease = parseScopeAuthorization(value, expected, Date.now());
  expect(() => lease.assertAgentModel({ baseUrl: "https://model.fixture/v1", id: "approved" })).not.toThrow();
  for (const model of [null, { baseUrl: "invalid", id: "approved" },
    { baseUrl: "https://other.fixture/v1", id: "approved" },
    { baseUrl: "https://model.fixture/v1/", id: "approved" },
    { baseUrl: "https://model.fixture/v1", id: "Approved" },
    { baseUrl: "https://model.fixture/v1", id: "extract" },
    { baseUrl: "https://model.fixture/v1", id: "embed" }]) {
    expect(() => lease.assertAgentModel(model)).toThrow("not authorized");
  }
  expect(() => parseScopeAuthorization(snapshot(), expected, Date.now())
    .assertAgentModel({ baseUrl: "https://model.fixture/v1", id: "approved" })).toThrow();
});
it("bounds an immutable lease by request start and rejects expiry", () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const lease = parseScopeAuthorization(snapshot(), expected, Date.now() - 2_000);
  expect(lease.deadline).toBe(1_058_000);
  vi.advanceTimersByTime(58_000);
  expect(lease.assertValid).toThrow();
});
it.each([
  { userId: "other" }, { teamId: "other" }, { projectId: undefined }, { role: "unknown" },
  { permissionRevision: "bad" }, { leaseExpiresAt: "2000-01-01T00:00:00Z" },
  { leaseExpiresAt: "2999-01-01T00:00:00Z" }, { modelPolicy: { teamId: "other", revision: "0", allowedModels: [] } },
  { modelPolicy: { teamId: "team", revision: "01", allowedModels: [] } },
  { modelPolicy: { teamId: "team", revision: "1", allowedModels: [{ purpose: "agent", endpoint: "https://user:fixture@example.test", modelId: "fixture" }] } },
])("rejects malformed or mismatched authorization %#", (patch) => {
  expect(() => parseScopeAuthorization({ ...snapshot(), ...patch }, expected, Date.now())).toThrow();
});
it("requests the exact project and has no fallback on server denial", async () => {
  const fetch = vi.fn(async (_input: string | URL | Request) => Response.json(snapshot()));
  vi.stubGlobal("fetch", fetch);
  const client = new EnterpriseContextGatewayClient("https://fixture.invalid", "synthetic");
  await client.authorizeProject("user", "team", "project");
  expect(fetch.mock.calls[0]?.[0]).toBe("https://fixture.invalid/v1/agent/teams/team/projects/project/authorization");
  fetch.mockImplementation(async () => new Response(null, { status: 403 }));
  await expect(client.authorizeProject("user", "team", "project")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
