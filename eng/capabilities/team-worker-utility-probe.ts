import type { TeamModelRelayPort, TeamWorkerRequest } from "@pi67/protocol";
import { TeamWorkerBrokerClient } from "../../apps/agent-host/src/context/team-worker-broker-client.js";
import { TeamModelPortAdmission } from "../../apps/agent-host/src/context/team-model-port-admission.js";
import { EnterpriseContextController } from "../../apps/agent-host/src/context/enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "../../apps/agent-host/src/context/enterprise-credential-broker-client.js";

// Real utility process, synthetic identity/policy/model replies; no network or profile.
const parent = (process as NodeJS.Process & { parentPort: {
  on(type: "message", callback: (event: { data: unknown; ports: TeamModelRelayPort[] }) => void): void;
  postMessage(value: unknown): void;
} }).parentPort;
const mode = process.argv[2];
if (!["success", "deny", "cancel", "host-exit"].includes(mode ?? "")) throw new Error("Invalid synthetic worker mode.");
const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
globalThis.fetch = async () => mode === "deny" ? Response.json({}, { status: 403 }) : Response.json({
  userId: "user", teamId: "team", role: "member", permissionRevision: "a".repeat(64),
  issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  modelPolicy: { teamId: "team", revision: "1", allowedModels: [{ purpose: "embedding", endpoint: model.baseUrl, modelId: model.id }] }
});
const credentials = new EnterpriseCredentialBrokerClient({ postMessage() { throw new Error("Unexpected credential mutation."); } });
credentials.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: {
  endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: "team", expiresAt: Date.now() + 600_000
} });
const controller = new EnterpriseContextController({ read: async () => ({ enterpriseGatewayEndpoint: "https://service.invalid" }) } as never,
  {} as never, { sendFor() {} } as never, credentials);
const admission = new TeamModelPortAdmission(), broker = new TeamWorkerBrokerClient({ postMessage: (message: TeamWorkerRequest) => parent.postMessage(message) });
let job: Awaited<ReturnType<TeamWorkerBrokerClient["start"]>> | undefined, invoked = 0;
const reservation = controller.reserveTeamModelPort(admission, { teamId: "team", projectId: null,
  models: { embedding: model, extraction: model }, signal: new AbortController().signal,
  async invoke() {
    invoked += 1;
    if (mode === "host-exit") process.exit(0);
    if (mode === "cancel") { if (!job) throw new Error("Job was not admitted."); void job.stop().catch(() => undefined); return new Promise<never>(() => undefined); }
    return { status: 200, body: Buffer.from(JSON.stringify({ data: [{ index: 0, embedding: [0.25, 0.75] }], model: "fixture" })) };
  }
}, "worker");
void reservation.connected.catch(() => undefined);
parent.on("message", event => {
  if (admission.handleMessage(event) || broker.handleMessage(event.data)) return;
  if (!event.data || typeof event.data !== "object" || !("type" in event.data) || event.data.type !== "probe-launch") return;
  void broker.start(reservation).then(async handle => { job = handle; return await handle.completion; })
    .then(outcome => parent.postMessage({ type: "probe-done", outcome, invoked }),
      () => parent.postMessage({ type: "probe-done", outcome: "failed", invoked }));
});
parent.postMessage({ type: "probe-reserved", requestId: reservation.requestId });
process.once("SIGTERM", () => { broker.shutdown(); admission.shutdown(); controller.shutdown(); process.exit(0); });
