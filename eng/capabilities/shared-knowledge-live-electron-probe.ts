import assert from "node:assert/strict";
import { app, safeStorage, utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopSafeStorage } from "../../apps/desktop/src/desktop-safe-storage.js";
import { EnterpriseCredentialStore } from "../../apps/desktop/src/enterprise-credential-store.js";
import { EnterpriseCredentialSupervisor } from "../../apps/desktop/src/enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBroker } from "../../apps/desktop/src/shared-knowledge-receipt-broker.js";
import { SharedKnowledgeReceiptBinding } from "../../apps/desktop/src/shared-knowledge-receipt-binding.js";
import { authorizeSharedKnowledge } from "../../apps/desktop/src/shared-knowledge-authorization.js";
import { liveRecord, startLiveKnowledgeFixture } from "./shared-knowledge-live-fixture.js";
import { prepareLiveNative } from "./shared-knowledge-live-native-main.js";
import { awaitWebAction } from "./shared-knowledge-live-web.js";

const directory = process.env.PI67_KNOWLEDGE_ELECTRON_PROBE_DIR;
const liveDirectory = process.env.PI67_NEWMONEY_LIVE_DIRECTORY;
if (!directory || !liveDirectory || !isAbsolute(directory) || !isAbsolute(liveDirectory)) app.exit(1);
else {
  app.setPath("userData", directory);
  void app.whenReady().then(probe).then(() => {
    console.log("SHARED_KNOWLEDGE_ELECTRON_PASS: OS-encrypted credential reopen, real utility IPC, independent live Host/Main grants, durable sync, revocation, project denial, utility exit");
    app.exit(0);
  }).catch(() => {
    console.error("SHARED_KNOWLEDGE_ELECTRON_FAILED: bounded integration failed; no credentials or child payloads logged");
    app.exit(1);
  });
}

async function probe() {
  const root = join(directory!, "memory");
  const nativeRequested = process.env.PI67_KNOWLEDGE_PROBE_NATIVE === "1";
  const webRequested = process.env.PI67_KNOWLEDGE_PROBE_WEB === "1";
  let nativePreparation: Awaited<ReturnType<typeof prepareLiveNative>> | undefined;
  if (nativeRequested) {
    try {
      const python = process.env.PI67_TEAM_MODEL_TEST_PYTHON, bootstraps = process.env.PI67_KNOWLEDGE_PROBE_BOOTSTRAP_DIR;
      assert.ok(python && bootstraps && isAbsolute(python) && isAbsolute(bootstraps));
      nativePreparation = await prepareLiveNative(root, python, bootstraps);
      const waiting = AbortSignal.timeout(720_000);
      while (!existsSync(join(liveDirectory!, "connection.json"))) await delay(500, undefined, { signal: waiting });
    } catch { console.error("Live Electron stage failed: native-preparation"); throw new Error("Native fixture preparation failed"); }
  }
  const fixture = await startLiveKnowledgeFixture(liveDirectory!);
  let passed = false;
  let stage = "secure-storage";
  let cleanup: (() => Promise<void>) | undefined;
  try {
    assert.ok(!webRequested || nativeRequested && fixture.webGovernance, "Web mode requires the explicit matching Server fixture");
    const webIdentity = { teamId: fixture.scope.teamId, projectId: fixture.scope.scopeId, candidateId: fixture.candidateId };
    const encryption = new DesktopSafeStorage(safeStorage);
    assert.equal(encryption.ensureAvailable(), "available");
    const store = new EnterpriseCredentialStore(directory!, { encryption });
    await store.store(fixture.credential);
    const raw = await readFile(store.path, "utf8");
    assert.ok(!raw.includes(fixture.credential.accessToken));
    const envelope = liveRecord(JSON.parse(raw) as unknown);
    assert.equal(typeof envelope.encryptedCredential, "string");
    assert.ok(!Buffer.from(envelope.encryptedCredential as string, "base64").includes(Buffer.from(fixture.credential.accessToken)));
    assert.equal((await lstat(store.path)).mode & 0o777, 0o600);
    const reopened = new EnterpriseCredentialStore(directory!, { encryption: new DesktopSafeStorage(safeStorage) });
    const loaded = await reopened.load();
    // Boolean assertions avoid printing credentials if the comparison fails.
    assert.ok(loaded.storage === "available" && JSON.stringify(loaded.credential) === JSON.stringify(fixture.credential));
    const credentials = new EnterpriseCredentialSupervisor(() => reopened);
    await credentials.bootstrapMessage();
    const identity = { endpoint: fixture.credential.endpoint, userId: fixture.credential.userId };
    const localProfileId = nativePreparation?.localProfileId ?? randomUUID();
    let currentHost: ReturnType<typeof utilityProcess.fork> | undefined;
    const native = nativePreparation?.compose(() => currentHost);
    let authorizations = 0, operations = 0;
    const broker = new SharedKnowledgeReceiptBroker({
      createBinding: scope => credentials.createReceiptBinding(native ? join(root, "team-projections", "receipts") : root, localProfileId, scope),
      authorize: (scope, requested, signal) => { authorizations++; return authorizeSharedKnowledge(reopened, scope, requested, signal); },
      ...native?.dependencies
    });
    const host = utilityProcess.fork(fileURLToPath(new URL("./shared-knowledge-live-utility-probe.mjs", import.meta.url)), [], {
      stdio: "ignore", cwd: directory!, env: { PATH: process.env.PATH ?? "", NODE_EXTRA_CA_CERTS: join(liveDirectory!, "cert.pem") }
    });
    currentHost = host;
    let exited = false;
    const exit = new Promise<void>(resolve => host.once("exit", () => { exited = true; currentHost = undefined; broker.invalidate(); resolve(); }));
    let pending: { resolve(value: unknown): void; reject(): void } | undefined;
    host.on("message", (message: unknown) => {
      if (native?.handleMessage(host, message)) return;
      const operation = broker.operation(message);
      if (operation) {
        operations++;
        void operation.then(result => { if (!exited && result) host.postMessage(result); }).catch(() => pending?.reject());
        return;
      }
      if (message && typeof message === "object" && "type" in message) {
        if (message.type === "probe-ready") { pending?.resolve(undefined); return; }
        if (message.type === "probe-result" && "result" in message) { pending?.resolve(message.result); return; }
        if (message.type === "probe-failed" && "diagnostics" in message && message.diagnostics) {
          const data = liveRecord(message.diagnostics);
          if ([data.modelCalls, data.queryEmbeddings, data.invokeAttempts, data.invokeStage].every(value => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1000)) {
            console.error(`LIVE_NATIVE_DIAGNOSTIC: modelCalls=${String(data.modelCalls)},queryEmbeddings=${String(data.queryEmbeddings)},invokeAttempts=${String(data.invokeAttempts)},invokeStage=${String(data.invokeStage)}`);
          }
          if ([data.queryStep, data.queryElapsedMs, data.queryAborted].every(value => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 120_000)) {
            console.error(`LIVE_QUERY_DIAGNOSTIC: step=${String(data.queryStep)},elapsedMs=${String(data.queryElapsedMs)},aborted=${String(data.queryAborted)}`);
          }
        }
      }
      pending?.reject();
    });
    host.once("exit", () => pending?.reject());
    async function request(message: unknown, timeoutMs = 50_000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await new Promise<unknown>((resolve, reject) => {
          pending = { resolve, reject: () => reject(new Error("Utility probe failed")) };
          timer = setTimeout(() => pending?.reject(), timeoutMs);
          host.postMessage(message);
        });
      } finally { clearTimeout(timer); pending = undefined; }
    }
    cleanup = async () => {
      broker.invalidate(); credentials.invalidateReceiptBindings();
      try { await native?.shutdown(); }
      finally {
        if (!exited) host.kill();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([exit, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Utility exit unconfirmed")), 5_000);
        })]); } finally { clearTimeout(timer); }
        await reopened.clear();
        assert.ok(!(await reopened.load()).credential);
      }
    };
    stage = "initialize";
    await request({ type: "probe-initialize", credential: loaded.credential, projectId: fixture.scope.scopeId, native: nativeRequested });
    const base = `/v1/agent/teams/${fixture.scope.teamId}`;
    stage = "publication";
    let publication: Record<string, unknown>;
    if (webRequested) {
      const absent = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`);
      assert.equal(absent.status, 404); await absent.body?.cancel();
      stage = "web-publication";
      await awaitWebAction(liveDirectory!, "publish", webIdentity, fixture.webSignal);
      const published = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`);
      assert.equal(published.status, 200);
      const detail = liveRecord(await published.json());
      assert.equal(detail.id, fixture.candidateId);
      assert.equal(detail.projectId, fixture.scope.scopeId);
      assert.equal(detail.status, "active");
      publication = { contentRevision: detail.externalRevision };
    } else {
      const published = await fixture.api(`${base}/candidates/${fixture.candidateId}/publish-versioned`, "POST");
      assert.equal(published.status, 201); publication = liveRecord(await published.json());
    }
    const policyResponse = await fixture.api(`${base}/model-policy`); assert.equal(policyResponse.status, 200);
    const policy = liveRecord(await policyResponse.json());
    const allowedModels = native ? ["embedding", "extraction"].map(purpose => ({ purpose, endpoint: "https://model.invalid/v1", modelId: "fixture" })) : [];
    const emptyPolicy = await fixture.api(`${base}/model-policy`, "PUT", { expectedRevision: policy.revision, allowedModels });
    assert.equal(emptyPolicy.status, 200); await emptyPolicy.body?.cancel();
    stage = "sync";
    assert.equal(liveRecord(await request({ type: "probe-run", mode: "sync" })).cursor, "1");
    assert.ok(authorizations > 0 && operations > 0);
    const previousAuthorizations = authorizations;
    assert.equal(liveRecord(await request({ type: "probe-run", mode: "sync" })).cursor, "1");
    assert.ok(authorizations > previousAuthorizations);
    const binding = new SharedKnowledgeReceiptBinding(native ? join(root, "team-projections", "receipts") : root, { ...fixture.scope, ...identity, localProfileId });
    assert.equal((await binding.read())?.cursor, "1");
    let assertPublished: (() => Promise<void>) | undefined;
    if (native) {
      stage = "native-index";
      const indexed = liveRecord(await request({ type: "probe-run", mode: "index" }, 190_000));
      assert.equal(indexed.state, "published-local");
      assertPublished = await native.capturePublished(binding.scopeKey);
      stage = "native-query";
      const searched = liveRecord(await request({ type: "probe-run", mode: "search" }, 70_000));
      assert.ok(searched.exactBody === true && Array.isArray(searched.hits) && searched.hits.length === 1);
      const hit = liveRecord(searched.hits[0]);
      assert.ok(hit.assetId === fixture.candidateId && hit.contentRevision === publication.contentRevision);
      await assertPublished();
    }
    stage = "revocation";
    const detail = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`); assert.equal(detail.status, 200);
    const etag = detail.headers.get("etag"); assert.ok(etag); await detail.body?.cancel();
    if (webRequested) {
      stage = "web-revocation";
      await awaitWebAction(liveDirectory!, "revoke", webIdentity, fixture.webSignal);
      const revoked = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`);
      assert.equal(revoked.status, 404); await revoked.body?.cancel();
    } else {
      const revoked = await fixture.api(`${base}/shared-assets/${fixture.candidateId}`, "DELETE", undefined, { "If-Match": etag });
      assert.equal(revoked.status, 204);
    }
    assert.equal(liveRecord(await request({ type: "probe-run", mode: "sync" })).cursor, "2");
    if (native) {
      stage = "native-stale";
      assert.ok(liveRecord(await request({ type: "probe-run", mode: "stale" }, 70_000)).staleDenied === true);
      await assertPublished!();
    }
    stage = "project-denial";
    const removed = await fixture.api(`${base}/projects/${fixture.scope.scopeId}/members/${identity.userId}`, "DELETE");
    assert.equal(removed.status, 204);
    const denied = liveRecord(await request({ type: "probe-run", mode: "denied" }));
    assert.ok(denied.projectDenied === true && denied.teamAllowed === true);
    assert.ok(!await authorizeSharedKnowledge(reopened, fixture.scope, identity, AbortSignal.timeout(8_000)));
    assert.equal((await binding.read())?.cursor, "2");
    stage = "cleanup";
    await cleanup(); cleanup = undefined;
    if (native) {
      await native.assertInstallation();
      console.log("SHARED_KNOWLEDGE_NATIVE_PASS: live index transaction, actual OpenViking index/query, exact asset/body, stale-index denial before embedding, intact generation and runtime trees, synthetic vectors only");
    }
    if (webRequested) {
      stage = "web-logout";
      await awaitWebAction(liveDirectory!, "logout", webIdentity, fixture.webSignal);
      console.log("SHARED_KNOWLEDGE_WEB_PASS: externally published and revoked exact candidate verified via HTTP and native index/query; browser interaction evidence remains separate");
    }
    passed = true;
  } catch {
    const stats = fixture.diagnostics();
    console.error(`LIVE_HTTP_DIAGNOSTIC: requests=${stats.requests},responses=${stats.responses},timeouts=${stats.timeouts},authorizationOk=${stats.authorizationOk},authorizationFailed=${stats.authorizationFailed}`);
    console.error(`Live Electron stage failed: ${stage}`);
    throw new Error("Live Electron probe failed");
  } finally {
    try { await cleanup?.(); }
    finally { await fixture.close(passed); }
  }
}
