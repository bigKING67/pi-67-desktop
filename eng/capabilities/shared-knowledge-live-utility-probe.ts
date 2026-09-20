import assert from "node:assert/strict";
import { isEnterpriseAccessCredential, type TeamModelRelayPort } from "@pi67/protocol";
import { createLiveNativeHost } from "./shared-knowledge-live-native-host.js";
import { EnterpriseContextGatewayClient } from "../../apps/agent-host/src/context/enterprise-context-gateway-client.js";
import { SharedKnowledgeReceiptClient } from "../../apps/agent-host/src/context/shared-knowledge-receipt-client.js";
import { syncSharedKnowledge } from "../../apps/agent-host/src/context/shared-knowledge-sync.js";

// Actual utility parentPort, but an isolated test Host rather than product startup.
const parent = (process as NodeJS.Process & { parentPort: {
  on(type: "message", callback: (event: { data: unknown; ports: TeamModelRelayPort[] }) => void): void;
  postMessage(value: unknown): void;
} }).parentPort;
let receipts: SharedKnowledgeReceiptClient | undefined;
let execute: ((mode: string) => Promise<unknown>) | undefined;
let busy = false;
let native: ReturnType<typeof createLiveNativeHost> | undefined;
parent.on("message", event => {
  if (native?.handleMessage(event)) return;
  const { data } = event;
  if (receipts?.handleResult(data)) return;
  void handle(data).catch(() => {
    parent.postMessage({ type: "probe-failed", diagnostics: native?.diagnostics() });
    receipts?.shutdown();
  });
});
async function handle(data: unknown) {
  assert.ok(data && typeof data === "object" && "type" in data);
  if (data.type === "probe-initialize") {
    assert.ok(!execute && "credential" in data && isEnterpriseAccessCredential(data.credential));
    assert.ok("projectId" in data && typeof data.projectId === "string");
    const credential = data.credential;
    if ("native" in data && data.native === true) native = createLiveNativeHost(parent, credential, data.projectId);
    const scope = { teamId: credential.accountId, scopeKind: "project" as const, scopeId: data.projectId };
    const gateway = new EnterpriseContextGatewayClient(credential.endpoint, credential.accessToken);
    const client = new SharedKnowledgeReceiptClient(parent, credential);
    receipts = client;
    execute = async mode => {
      if (["index", "search", "stale"].includes(mode)) { assert.ok(native); return native.run(mode); }
      const signal = AbortSignal.timeout(45_000);
      const options = { gateway, receipts: client, userId: credential.userId, scope, signal,
        maxPages: 10, assertCurrent: () => signal.throwIfAborted() };
      if (mode === "sync") {
        const grant = await gateway.authorizeProject(credential.userId, scope.teamId, scope.scopeId, signal);
        if (native) grant.assertModel("embedding", { baseUrl: "https://model.invalid/v1", id: "fixture" });
        else assert.throws(() => grant.assertModel("embedding", { baseUrl: "https://model.invalid/v1", id: "fixture" }));
        return (await syncSharedKnowledge(options)).progress;
      }
      assert.equal(mode, "denied");
      await assert.rejects(gateway.authorizeProject(credential.userId, scope.teamId, scope.scopeId, signal));
      await assert.rejects(syncSharedKnowledge(options));
      const denied = await client.request({ type: "shared-knowledge-receipt-open", scope }, signal);
      assert.equal(denied.ok, false);
      (await gateway.authorizeTeam(credential.userId, scope.teamId, signal)).assertValid();
      return { projectDenied: true, teamAllowed: true };
    };
    parent.postMessage({ type: "probe-ready" });
    return;
  }
  assert.ok(data.type === "probe-run" && "mode" in data && typeof data.mode === "string" && execute && !busy);
  busy = true;
  try { parent.postMessage({ type: "probe-result", result: await execute(data.mode) }); }
  finally { busy = false; }
}
process.once("SIGTERM", () => { native?.shutdown(); receipts?.shutdown(); process.exit(0); });
