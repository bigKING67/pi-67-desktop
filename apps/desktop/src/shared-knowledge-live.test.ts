import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EnterpriseContextGatewayClient } from "../../agent-host/src/context/enterprise-context-gateway-client.js";
import { SharedKnowledgeReceiptClient } from "../../agent-host/src/context/shared-knowledge-receipt-client.js";
import { syncSharedKnowledge } from "../../agent-host/src/context/shared-knowledge-sync.js";
import { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBroker } from "./shared-knowledge-receipt-broker.js";
import { SharedKnowledgeReceiptBinding } from "./shared-knowledge-receipt-binding.js";
import { authorizeSharedKnowledge } from "./shared-knowledge-authorization.js";
import { writeTeamIndexJob } from "./team-index-job.js";
import { liveRecord, startLiveKnowledgeFixture } from "../../../eng/capabilities/shared-knowledge-live-fixture.js";

const directory = process.env.PI67_NEWMONEY_LIVE_DIRECTORY;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it.skipIf(!directory)("uses live HTTPS for independent Host/Main grants, publication, sync and revocation against VPS PostgreSQL", async () => {
  assert.ok(directory);
  const fixture = await startLiveKnowledgeFixture(directory);
  cleanups.push(() => fixture.close(false));
  const { credential, scope } = fixture;
  const serviceIdentity = { endpoint: credential.endpoint, userId: credential.userId };
  const root = await mkdtemp(join(tmpdir(), "new-money-live-receipts-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const localProfileId = randomUUID();
  const store = { load: async () => ({ storage: "available" as const, credential }),
    store: async () => { throw new Error("No real credential writes"); }, clear: async () => { throw new Error("No real credential clearing"); } };
  const credentials = new EnterpriseCredentialSupervisor(() => store);
  await credentials.bootstrapMessage();
  let mainAuthorizations = 0, passed = false;
  const broker = new SharedKnowledgeReceiptBroker({
    createBinding: requested => credentials.createReceiptBinding(root, localProfileId, requested),
    authorize: (requested, identity, signal) => { mainAuthorizations++; return authorizeSharedKnowledge(store, requested, identity, signal); }
  });
  let receipts: SharedKnowledgeReceiptClient;
  receipts = new SharedKnowledgeReceiptClient({ postMessage(message) {
    // Actual client/broker protocol, but an in-process seam, not Electron IPC.
    void broker.operation(message)?.then(result => { if (result) receipts.handleResult(result); }).catch(() => receipts.shutdown());
  } }, serviceIdentity);
  const gateway = new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken);
  const signal = AbortSignal.timeout(210_000);
  const options = { gateway, receipts, userId: credential.userId, scope, signal, maxPages: 10, assertCurrent: () => signal.throwIfAborted() };
  const base = `/v1/agent/teams/${scope.teamId}`;
  try {
    const published = await fixture.api(`${base}/candidates/${fixture.candidateId}/publish-versioned`, "POST");
    expect(published.status).toBe(201);
    const receipt = liveRecord(await published.json());
    expect(receipt.assetId).toBe(fixture.candidateId); expect(receipt.replayed).toBe(false);
    const replay = await fixture.api(`${base}/candidates/${fixture.candidateId}/publish-versioned`, "POST");
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual({ ...receipt, replayed: true });
    const policyResponse = await fixture.api(`${base}/model-policy`); expect(policyResponse.status).toBe(200);
    const policy = liveRecord(await policyResponse.json());
    const emptyPolicy = await fixture.api(`${base}/model-policy`, "PUT", { expectedRevision: policy.revision, allowedModels: [] });
    expect(emptyPolicy.status).toBe(200); await emptyPolicy.body?.cancel();
    const grant = await gateway.authorizeProject(credential.userId, scope.teamId, scope.scopeId, signal);
    expect(() => grant.assertModel("embedding", { baseUrl: "https://model.invalid/v1", id: "fixture" })).toThrow();
    const synced = await syncSharedKnowledge(options);
    expect(synced.progress.cursor).toBe("1"); expect(synced.headCursor).toBe("1");
    // Main obtains its own grant on open; append validates the held grant.
    // A separate sync opens a fresh handle and must independently authorize again.
    expect(mainAuthorizations).toBeGreaterThan(0);
    const firstMainAuthorizations = mainAuthorizations;
    const binding = new SharedKnowledgeReceiptBinding(root, { ...scope, ...serviceIdentity, localProfileId });
    const before = await binding.read(); expect(before?.cursor).toBe("1");
    expect((await syncSharedKnowledge(options)).progress).toEqual(synced.progress);
    expect(mainAuthorizations).toBeGreaterThan(firstMainAuthorizations);
    const jobRoot = join(root, "job"); await mkdir(jobRoot, { mode: 0o700 });
    const identity = await lstat(jobRoot);
    const assertStorage = async () => { const current = await lstat(jobRoot);
      assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.ino === identity.ino && current.dev === identity.dev); };
    const readGrant = await authorizeSharedKnowledge(store, scope, serviceIdentity, signal); assert.ok(readGrant);
    const input = { binding, prepared: { scopeKey: binding.scopeKey, directory: jobRoot, assertStorage, assertCurrent: assertStorage },
      assertReadable: readGrant.assertValid, signal, limits: { maxPages: 10, maxAssets: 100 },
      models: { embedding: { endpoint: "https://model.invalid/v1", model: "fixture", dimension: 8 },
        extraction: { endpoint: "https://model.invalid/v1", model: "fixture" } } };
    // Input only: model policy is empty, so no worker or model may run.
    const job = await writeTeamIndexJob(input);
    expect(job.documents).toEqual([{ assetId: fixture.candidateId, contentRevision: receipt.contentRevision }]);
    const written = liveRecord(JSON.parse(await readFile(join(jobRoot, "job.json"), "utf8")) as unknown);
    assert.ok(Array.isArray(written.documents));
    const document = liveRecord(written.documents[0]); assert.equal(typeof document.canonicalContent, "string");
    expect(JSON.parse(document.canonicalContent as string)[4]).toBe("Synthetic live body");
    const detail = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`); expect(detail.status).toBe(200);
    const etag = detail.headers.get("etag"); assert.ok(etag); await detail.body?.cancel();
    const revoked = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`, "DELETE", undefined, { "If-Match": etag });
    expect(revoked.status).toBe(204);
    expect((await syncSharedKnowledge(options)).progress.cursor).toBe("2");
    await expect(job.assertSnapshotCurrent()).rejects.toThrow("snapshot changed"); await job.discardInput();
    await expect(writeTeamIndexJob(input)).rejects.toThrow("empty"); expect(await readdir(jobRoot)).toEqual([]);
    const removed = await fixture.api(`${base}/projects/${scope.scopeId}/members/${credential.userId}`, "DELETE");
    expect(removed.status).toBe(204);
    await expect(gateway.authorizeProject(credential.userId, scope.teamId, scope.scopeId, signal)).rejects.toThrow();
    expect(await authorizeSharedKnowledge(store, scope, serviceIdentity, signal)).toBeUndefined();
    await expect(syncSharedKnowledge(options)).rejects.toThrow();
    expect(await receipts.request({ type: "shared-knowledge-receipt-open", scope }, signal)).toMatchObject({ ok: false });
    expect((await binding.read())?.cursor).toBe("2");
    (await gateway.authorizeTeam(credential.userId, scope.teamId, signal)).assertValid();
    passed = true;
  } finally {
    receipts.shutdown(); broker.invalidate(); credentials.invalidateReceiptBindings();
    await rm(root, { recursive: true, force: true });
    await fixture.close(passed);
  }
}, 240_000);
