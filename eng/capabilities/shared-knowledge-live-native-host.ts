import assert from "node:assert/strict";
import type { EnterpriseAccessCredential, TeamModelRelayPort } from "@pi67/protocol";
import { EnterpriseCredentialBrokerClient } from "../../apps/agent-host/src/context/enterprise-credential-broker-client.js";
import { EnterpriseAuthorizationController } from "../../apps/agent-host/src/context/enterprise-authorization-controller.js";
import { EnterpriseContextGatewayClient } from "../../apps/agent-host/src/context/enterprise-context-gateway-client.js";
import { TeamIndexHeadResponder } from "../../apps/agent-host/src/context/team-index-head-responder.js";
import { TeamModelPortAdmission } from "../../apps/agent-host/src/context/team-model-port-admission.js";
import { TeamWorkerBrokerClient } from "../../apps/agent-host/src/context/team-worker-broker-client.js";
import { runSharedKnowledgeQuery } from "../../apps/agent-host/src/context/shared-knowledge-query.js";

// Only model execution is synthetic: every index frame and query embedding still
// requires actual current project/model authorization from the real server.
export function createLiveNativeHost(parent: { postMessage(value: unknown): void }, credential: EnterpriseAccessCredential, projectId: string) {
  const credentials = new EnterpriseCredentialBrokerClient(parent);
  credentials.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential });
  const controller = new EnterpriseAuthorizationController({ read: async () => ({ enterpriseGatewayEndpoint: credential.endpoint }) } as never,
    { sendFor() { throw new Error("Unexpected identity mutation"); } } as never, credentials);
  const heads = new TeamIndexHeadResponder(parent, (input, signal) => controller.observeIndexHead(input, signal));
  const ports = new TeamModelPortAdmission(), workers = new TeamWorkerBrokerClient(parent);
  const model = { baseUrl: "https://model.invalid/v1", id: "fixture" }, vector = [0.25, 0.75, 0, 0, 0, 0, 0, 0];
  const scope = { teamId: credential.accountId, scopeKind: "project" as const, scopeId: projectId };
  const gateway = new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken);
  let modelCalls = 0, queryEmbeddings = 0, invokeAttempts = 0, invokeStage = 0;
  let queryStep = 0, queryElapsedMs = 0, queryAborted = 0;
  return {
    diagnostics() { return { modelCalls, queryEmbeddings, invokeAttempts, invokeStage, queryStep, queryElapsedMs, queryAborted }; },
    handleMessage(event: { data: unknown; ports: readonly TeamModelRelayPort[] }) {
      return ports.handleMessage(event) || heads.handleMessage(event.data) || workers.handleMessage(event.data) || credentials.handleReceiptResult(event.data);
    },
    async run(mode: string) {
      const signal = AbortSignal.timeout(mode === "index" ? 180_000 : 60_000);
      const receipts = credentials.sharedKnowledgeReceipts(); assert.ok(receipts);
      if (mode === "index") {
        const result = await controller.indexKnowledge(ports, workers, { teamId: scope.teamId, projectId, signal,
          models: { embedding: model, extraction: model }, embeddingDimension: 8,
          async invoke(purpose, selected, body, requestSignal) {
            invokeAttempts++; invokeStage = 1;
            requestSignal.throwIfAborted(); assert.equal(purpose, "embedding"); assert.deepEqual(selected, model); modelCalls++;
            invokeStage = 2;
            const input = (JSON.parse(Buffer.from(body).toString()) as { input: string | string[] }).input;
            const inputs = Array.isArray(input) ? input : [input];
            invokeStage = 3;
            return { status: 200, body: Buffer.from(JSON.stringify({ model: model.id,
              data: inputs.map((_, index) => ({ index, embedding: vector })) })) };
          }
        });
        assert.ok(modelCalls > 0); return result;
      }
      const search = async () => {
        const started = performance.now(); queryStep = 0;
        try { return await runSharedKnowledgeQuery({ receipts: {
          signal: receipts.signal,
          async request(input, caller) {
            const step = input.type === "shared-knowledge-receipt-open" ? 1
              : input.type === "shared-knowledge-index-query-prepare" ? 3
                : input.type === "shared-knowledge-index-query" ? 7 : 0;
            if (step) queryStep = step;
            const result = await receipts.request(input, caller);
            if (step && result.ok) queryStep = step + 1;
            return result;
          }
        }, scope, query: "synthetic live knowledge", limit: 1, signal,
        assertCurrent: () => signal.throwIfAborted(), async embed(_query, selected, caller) {
          queryStep = 5;
          assert.deepEqual(selected, { endpoint: model.baseUrl, model: model.id, dimension: 8 });
          const grant = await gateway.authorizeProject(credential.userId, scope.teamId, projectId, caller);
          grant.assertModel("embedding", model); caller.throwIfAborted(); queryEmbeddings++;
          queryStep = 6;
          return vector;
        } }); } finally {
          queryElapsedMs = Math.round(performance.now() - started); queryAborted = Number(signal.aborted);
        }
      };
      if (mode === "stale") {
        const before = queryEmbeddings; await assert.rejects(search()); assert.equal(queryEmbeddings, before);
        return { staleDenied: true };
      }
      assert.equal(mode, "search");
      const result = await search(); assert.equal(result.hits.length, 1);
      const opened = await receipts.request({ type: "shared-knowledge-receipt-open", scope }, signal);
      assert.ok(opened.ok && opened.type === "shared-knowledge-receipt-open-result");
      try {
        const hit = result.hits[0]!;
        const read = await receipts.request({ type: "shared-knowledge-index-read", handleId: opened.handleId,
          snapshot: result.snapshot, assetId: hit.assetId, contentRevision: hit.contentRevision }, signal);
        assert.ok(read.ok && read.type === "shared-knowledge-index-read-result");
        const canonical = JSON.parse(read.canonicalContent) as unknown;
        assert.ok(Array.isArray(canonical) && canonical[4] === "Synthetic live body");
      } finally {
        const closed = await receipts.request({ type: "shared-knowledge-receipt-close", handleId: opened.handleId }); assert.ok(closed.ok);
      }
      return { ...result, modelCalls, queryEmbeddings, exactBody: true };
    },
    shutdown() { heads.shutdown(); ports.shutdown(); workers.shutdown(); controller.shutdown(); }
  };
}
