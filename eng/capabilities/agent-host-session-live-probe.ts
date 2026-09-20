import assert from "node:assert/strict";
import { safeStorage } from "electron";
import { lstat, readFile, realpath } from "node:fs/promises";
import { sep } from "node:path";
import { DesktopSafeStorage } from "../../apps/desktop/src/desktop-safe-storage.js";
import { EnterpriseCredentialStore } from "../../apps/desktop/src/enterprise-credential-store.js";
import { EnterpriseCredentialSupervisor } from "../../apps/desktop/src/enterprise-credential-supervisor.js";
import { startLiveKnowledgeFixture } from "./shared-knowledge-live-fixture.js";
import type { SessionProbeHost } from "./agent-host-session-electron-probe.js";
import type { CommandResults, TaskProtocolContext } from "@pi67/protocol";

type StartHost = (root: string, epoch: number, credentials: EnterpriseCredentialSupervisor) => Promise<SessionProbeHost>;

// Real Host/SDK and Main credential owners; no product Main/Renderer or model invocation.
export async function probeLiveHostSession(root: string, directory: string, startHost: StartHost, stage: (value: string) => void) {
  const fixture = await startLiveKnowledgeFixture(directory);
  const encryption = new DesktopSafeStorage(safeStorage);
  const createStore = () => new EnterpriseCredentialStore(root, { encryption });
  let store = createStore(), host: SessionProbeHost | undefined, passed = false;
  const appContext = { scope: "app" as const };
  const workspaceContext = { scope: "workspace" as const, workspaceId: "live-session-workspace" };
  const task = (taskId: string): TaskProtocolContext => ({ ...workspaceContext, scope: "task", taskId, taskGeneration: 1 });
  const scope = { teamId: fixture.scope.teamId, projectId: fixture.scope.scopeId };
  const closeHost = async () => { const current = host; host = undefined; await current?.close(); };
  async function boot(epoch: number) {
    host = await startHost(root, epoch, new EnterpriseCredentialSupervisor(() => store));
    await host.request("workspace.register", { cwd: host.workspace, trust: "trusted", approvalMode: "guided" }, workspaceContext);
    return host;
  }
  async function resolveSession(creationId: string, result: CommandResults["session.create"]) {
    const resolved = await host!.request("session.creation.resolve", { creationId }, workspaceContext);
    assert.ok(resolved?.status === "materialized" && resolved.sessionId === result.sessionId);
    const path = await realpath(resolved.sessionPath); assert.ok(path.startsWith(`${root}${sep}`));
    return { path, bytes: await readFile(path) };
  }
  try {
    stage("live-secure-storage"); assert.equal(encryption.ensureAvailable(), "available");
    let current = await boot(1);
    assert.equal((await current.request("enterprise.identity.get", {}, appContext))?.state, "signed-out");
    const privateSession = await current.request("session.create", { creationId: "live-private" }, task("private")); assert.ok(privateSession);
    const privateFile = await resolveSession("live-private", privateSession);
    const config = await current.request("context.config.get", {}, appContext); assert.ok(config);
    const { revision, recallTimeoutMs: _recall, healthTimeoutMs: _health,
      captureToolResults: _captureTools, actorScopeOnly: _actorScope, ...editable } = config;
    await current.request("context.config.update", { ...editable, expectedRevision: revision, enabled: false,
      enterpriseGatewayEndpoint: fixture.credential.endpoint }, appContext);
    const authorization = await current.request("enterprise.auth.begin", {}, appContext); assert.ok(authorization);
    stage("live-device-approve"); await fixture.approveDevice(authorization.userCode);
    const identity = await current.request("enterprise.auth.poll", { authorizationId: authorization.authorizationId }, appContext);
    assert.ok(identity?.state === "signed-in" && identity.userId === fixture.credential.userId);
    stage("live-credential-persistence");
    const credential = (await store.load()).credential; assert.ok(credential);
    const raw = await readFile(store.path, "utf8");
    assert.ok(!raw.includes(credential.accessToken) && !!credential.refreshToken && !raw.includes(credential.refreshToken));
    assert.equal((await lstat(store.path)).mode & 0o777, 0o600);
    const teamSession = await current.request("session.create", { creationId: "live-team", teamScope: scope }, task("team")); assert.ok(teamSession);
    const teamFile = await resolveSession("live-team", teamSession);
    stage("live-team-provenance");
    const markers = teamFile.bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>)
      .filter(record => record.type === "custom" && record.customType === "pi67.memory-provenance.v1");
    assert.equal(markers.length, 1);
    assert.deepEqual(markers[0]!.data, { version: 1, kind: "team", originSessionId: teamSession.sessionId,
      userId: fixture.credential.userId, ...scope, endpoint: fixture.credential.endpoint });
    assert.ok(privateFile.bytes.equals(await readFile(privateFile.path)));
    stage("live-first-shutdown"); await closeHost();
    store = createStore();
    assert.ok((await store.load()).credential?.accessToken === credential.accessToken);
    current = await boot(2);
    assert.equal((await current.request("enterprise.identity.get", {}, appContext))?.state, "signed-in");
    const restored = await current.request("runtime.initialize", { cwd: current.workspace, agentDir: current.agentDir,
      sessionPath: teamFile.path, trust: "trusted", approvalMode: "guided" }, task("restored")); assert.ok(restored);
    assert.equal(restored.sessionId, teamSession.sessionId);
    const context = { ...task("restored"), sessionId: restored.sessionId,
      sessionFileIdentity: restored.sessionFileIdentity, sessionGeneration: restored.sessionGeneration };
    const projection = await current.request("projection.resync", {}, context);
    assert.deepEqual(projection?.snapshot.memoryOrigin, { kind: "team", ...scope });
    // Fulfil the existing producer's independent publish/revoke/member-removal evidence contract.
    stage("live-governance");
    const base = `/v1/agent/teams/${scope.teamId}`;
    const publication = await fixture.api(`${base}/candidates/${fixture.candidateId}/publish-versioned`, "POST");
    assert.equal(publication.status, 201); await publication.body?.cancel();
    const detail = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`);
    assert.equal(detail.status, 200); const etag = detail.headers.get("etag"); assert.ok(etag); await detail.body?.cancel();
    const revoked = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`, "DELETE", undefined, { "If-Match": etag });
    assert.equal(revoked.status, 204); await revoked.body?.cancel();
    const removed = await fixture.api(`${base}/projects/${scope.projectId}/members/${fixture.credential.userId}`, "DELETE");
    assert.equal(removed.status, 204); await removed.body?.cancel();
    const beforeDenial = await readFile(teamFile.path);
    await current.request("session.create", { creationId: "live-revoked-team", teamScope: scope }, context,
      "The New Money team does not have permission for this operation.");
    assert.ok(beforeDenial.equals(await readFile(teamFile.path)));
    assert.equal((await current.request("session.creation.resolve", { creationId: "live-revoked-team" }, workspaceContext))?.status, "missing");
    assert.deepEqual((await current.request("projection.resync", {}, context))?.snapshot.memoryOrigin, { kind: "team", ...scope });
    assert.equal((await current.request("enterprise.auth.disconnect", {}, appContext))?.state, "signed-out");
    assert.equal(fixture.diagnostics().sessionRevocations, 1);
    assert.ok(!(await store.load()).credential);
    stage("live-second-shutdown"); await closeHost();
    store = createStore(); current = await boot(3);
    assert.equal((await current.request("enterprise.identity.get", {}, appContext))?.state, "signed-out");
    await current.request("session.create", { creationId: "live-signed-out-team", teamScope: scope }, task("signed-out"), true);
    assert.ok(privateFile.bytes.equals(await readFile(privateFile.path)));
    assert.equal((await current.request("session.creation.resolve", { creationId: "live-signed-out-team" }, workspaceContext))?.status, "missing");
    stage("live-final-shutdown"); await closeHost(); passed = true;
  } finally {
    try { await closeHost().then(() => store.clear()).catch(error => { passed = false; throw error; }); }
    finally { await fixture.close(passed); }
  }
}
