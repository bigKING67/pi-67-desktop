import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { SharedKnowledgeIndexHeadRequest } from "@pi67/protocol";
import { EnterpriseCredentialSupervisor } from "./enterprise-credential-supervisor.js";
import { SharedKnowledgeReceiptBroker } from "./shared-knowledge-receipt-broker.js";
import { authorizeSharedKnowledge } from "./shared-knowledge-authorization.js";
import { TeamIndexHeadClient } from "./team-index-head-client.js";
import { SharedKnowledgeReceiptClient } from "../../agent-host/src/context/shared-knowledge-receipt-client.js";
import { TeamIndexHeadResponder } from "../../agent-host/src/context/team-index-head-responder.js";
import { EnterpriseAuthorizationController } from "../../agent-host/src/context/enterprise-authorization-controller.js";
import { EnterpriseCredentialBrokerClient } from "../../agent-host/src/context/enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "../../agent-host/src/context/enterprise-context-gateway-client.js";
import { verifySharedKnowledgeIndexHead } from "../../agent-host/src/context/shared-knowledge-index-head.js";
import { runSharedKnowledgeIndex } from "../../agent-host/src/context/shared-knowledge-index.js";

type Dependencies = ConstructorParameters<typeof SharedKnowledgeReceiptBroker>[0];
type Input = Parameters<NonNullable<Dependencies["prepareIndex"]>>[0];
type Task = Awaited<ReturnType<NonNullable<Dependencies["prepareIndex"]>>>;
type Verified = Awaited<Task["completion"]>;
const id = "00000000-0000-4000-8000-000000000001";
const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
const models = { embedding: { endpoint: "https://model.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://model.invalid/v1", model: "extract" } };
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

// Real in-process Host transaction, both IPC clients, Main receipt/authorization
// broker and Host Gateway. Scheduler/worker/artifact and atomic commit are fixtures;
// native filesystem publication and Electron transport have separate acceptance.
async function fixture(mode: string) {
  const root = await mkdtemp(join(tmpdir(), "new-money-publication-flow-"));
  const credential = { endpoint: "https://service.invalid", userId: "user", accountId: id, accessToken: "synthetic-only", expiresAt: Date.now() + 600_000 };
  const store = { load: async () => ({ storage: "available" as const, credential }), store: async () => {}, clear: async () => {} };
  const credentials = new EnterpriseCredentialSupervisor(() => store); await credentials.bootstrapMessage();
  const hostCredentials = new EnterpriseCredentialBrokerClient({ postMessage() {} });
  hostCredentials.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential });
  const owner = new EnterpriseAuthorizationController({ read: async () => ({ enterpriseGatewayEndpoint: credential.endpoint }) } as never,
    { sendFor() {} } as never, hostCredentials);
  let publishing = false, committed = false;
  const calls: string[] = [], heads: SharedKnowledgeIndexHeadRequest[] = [];
  const fetcher = vi.fn<typeof fetch>(async url => {
    const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (publishing && mode === "read-denied") return Response.json({}, { status: 403 });
    const lease = { issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), permissionRevision: "a".repeat(64) };
    if (address.endsWith("/authorization")) return Response.json({ ...lease, userId: "user", teamId: id, role: "member", modelPolicy: {
      teamId: id, revision: "1", allowedModels: Object.entries(models).filter(([purpose]) => !(publishing && mode === "model-denied" && purpose === "extraction"))
        .map(([purpose, model]) => ({ purpose, endpoint: model.endpoint, modelId: model.model })) } });
    return Response.json({ ...lease, ...scope, epoch: id, nextCursor: "7", headCursor: publishing && mode === "head-drift" ? "8" : "7", hasMore: false, changes: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  const host = { postMessage(message: SharedKnowledgeIndexHeadRequest) { heads.push(message); responder.handleMessage(message); } };
  const headClient = new TeamIndexHeadClient(() => host);
  const responder = new TeamIndexHeadResponder({ postMessage: message => { headClient.handleMessage(host, message); } },
    (input, signal) => owner.observeIndexHead(input, signal));
  const caller = new AbortController();
  let finish!: () => void;
  const publisher = vi.fn<Verified["publication"]["publish"]>();
  const prepareIndex = async (input: Input): Promise<Task> => {
    const snapshot = { epoch: id, cursor: "7", receiptRecord: "b".repeat(64) };
    const artifact = { sha256: "c".repeat(64), files: 1, directories: 1, bytes: 10 };
    const expected = { scopeKey: input.binding.scopeKey, models: input.models, snapshot, artifact };
    publisher.mockImplementation(async (observe, signal) => {
      publishing = true; const check = await observe(expected, signal);
      if (mode === "host-retired") owner.retireTeamModelChannels();
      check(); committed = true;
      if (mode === "post-commit-failure") throw Object.assign(new Error("Synthetic durability failure"), { outcome: "indeterminate" });
      return { state: "published-local", pointer: { schema: "newmoney.team-index-pointer.v1", scopeKey: input.binding.scopeKey,
        generation: "run-synthetic", manifest: "d".repeat(64), epoch: id, cursor: "7" } };
    });
    const completion = new Promise<Verified>(resolve => { finish = () => resolve({ scopeKey: input.binding.scopeKey, directory: "/synthetic-only", models: input.models,
      snapshot: { ...snapshot, scope, capturedHeadCursor: "7", pages: 1, versions: [] }, artifact, documents: [],
      assertArtifactCurrent: async () => input.assertReadable(), publication: { publish: publisher } }); });
    return { scopeKey: input.binding.scopeKey, completion, register() {}, cancel() {} };
  };
  const broker = new SharedKnowledgeReceiptBroker({ createBinding: selected => credentials.createReceiptBinding(root, id, selected),
    authorize: (selected, identity, signal) => authorizeSharedKnowledge(store, selected, identity, signal),
    revalidateIndex: (input, signal) => headClient.verify(input, signal), prepareIndex });
  const receipts = new SharedKnowledgeReceiptClient({ postMessage(message) {
    calls.push(message.type);
    void broker.operation(message)?.then(result => {
      if (mode === "lost-reply" && message.type === "shared-knowledge-index-publish") { caller.abort(); return; }
      receipts.handleResult(result);
    });
  } }, credential);
  const reservation: ReturnType<Parameters<typeof runSharedKnowledgeIndex>[0]["reserve"]> = { phase: "worker", requestId: id, signal: caller.signal, connected: Promise.resolve(), activate() {}, stop() {} };
  const gateway = new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken);
  disposals.push(async () => { receipts.shutdown(); broker.invalidate(); headClient.retire(); responder.shutdown(); owner.shutdown(); await rm(root, { recursive: true, force: true }); });
  const run = () => runSharedKnowledgeIndex({ scope, models, receipts, signal: caller.signal, assertCurrent: () => caller.signal.throwIfAborted(), reserve: () => reservation,
    workers: { start: async () => { finish(); return { completion: Promise.resolve("completed" as const), stop: async () => "completed" as const }; } },
    revalidate: (snapshot, signal) => verifySharedKnowledgeIndexHead(gateway, { userId: "user", scope, models, snapshot }, signal) });
  return { run, calls, heads, fetcher, publisher, committed: () => committed };
}
it("publishes once through Main's fresh independent authorization and current-Host observation", async () => {
  const f = await fixture("success");
  await expect(f.run()).resolves.toEqual({ state: "published-local", snapshot: { epoch: id, cursor: "7" } });
  expect(f.committed()).toBe(true); expect(f.publisher).toHaveBeenCalledOnce();
  expect(f.calls.filter(type => type === "shared-knowledge-index-publish")).toHaveLength(1);
  expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
  expect(f.heads.map(message => message.type)).toEqual(["team-index-head-check", "team-index-head-cancel"]);
  expect(f.heads[0]).toMatchObject({ permissionRevision: "a".repeat(64), snapshot: { epoch: id, cursor: "7" }, models });
  expect(f.fetcher).toHaveBeenCalledTimes(6); // open read, early scope/head, commit read, commit scope/head
});
it.each(["read-denied", "model-denied", "head-drift", "host-retired"])("never commits after %s at the Main boundary", async mode => {
  const f = await fixture(mode), error = await f.run().catch((value: unknown) => value);
  expect(error).toBeInstanceOf(Error); expect(error).not.toHaveProperty("outcome"); expect(f.committed()).toBe(false);
  expect(f.calls.filter(type => type === "shared-knowledge-index-publish")).toHaveLength(1);
  expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});
it.each(["post-commit-failure", "lost-reply"])("retains possible commit across %s and does not retry", async mode => {
  const f = await fixture(mode);
  await expect(f.run()).rejects.toMatchObject({ outcome: "indeterminate" });
  expect(f.committed()).toBe(true); expect(f.publisher).toHaveBeenCalledOnce();
  expect(f.calls.filter(type => type === "shared-knowledge-index-publish")).toHaveLength(1);
  expect(f.calls.at(-1)).toBe("shared-knowledge-receipt-close");
});
