import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectTeamPhaseDiagnostics } from "./packaged-team-phase-diagnostics.mjs";

const stages = ["prepare", "private-session", "install-team-runtimes-and-models", "wait-for-live-api",
  "device-login", "device-begin", "device-approve", "device-overview", "project-binding",
  "publication-and-product-sync", "product-sync", "native-project-index", "team-session",
  "cold-recovery", "revocation-and-denial", "revoked-native-history-denial", "cold-signed-out"];
const queryStages = ["receipt-open", "index-preparation", "embedding", "native-query", "receipt-close"];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const counts = (value, keys) => Object.fromEntries(keys.map(key => [key, count(value?.[key])]));

export function packagedTeamQueryStages(entries) {
  return queryStages.filter(stage => entries.some(entry => entry.type === "message"
    && entry.message.role === "toolResult" && entry.message.isError
    && entry.message.content.some(part => part.type === "text"
      && part.text.includes(`Shared knowledge query unavailable. Stage: ${stage}.`))));
}

// Engineering evidence only. Project known metadata; never serialize the input,
// an Error, a credential, the synthetic profile, or a model/Tool payload.
export async function writePackagedTeamSessionReceipt(evidenceRoot, input) {
  if (!/^[a-f0-9]{64}$/u.test(input.asarSha256)) throw new Error("Packaged receipt requires an exact asar hash.");
  const cleanup = { completed: input.cleanupCompleted === true, electronClosed: input.closed === true,
    profileRemoved: input.profileRemoved === true };
  const passed = input.passed === true && Object.values(cleanup).every(Boolean);
  const timeline = (input.transport?.timeline ?? []).slice(-128).map(event => ({
    sequence: count(event.sequence), operation: ["authorization", "sync", "other"].includes(event.operation) ? event.operation : "other",
    elapsedMs: count(event.elapsedMs), status: Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : null,
    closed: event.closed === true
  }));
  const receipt = {
    schema: "pi67.packaged-team-session-receipt.v1", recordedAt: new Date().toISOString(),
    status: passed ? "PASS" : "FAILED",
    mode: input.native === true ? "native" : "non-native", asarSha256: input.asarSha256,
    stage: stages.includes(input.stage) ? input.stage : "unknown", stageElapsedMs: count(input.stageElapsedMs),
    failureKind: passed ? null : ["Error", "TimeoutError", "AssertionError"].includes(input.failureKind) ? input.failureKind : "unknown",
    query: { observed: input.queryObserved === true, stages: queryStages.filter(stage => input.queryStages?.includes(stage)),
      embeddingRequestsSinceStart: count(input.queryEmbeddingRequests), afterRequestSequence: count(input.queryAfterRequestSequence) },
    model: counts(input.model, ["agent", "embedding", "extraction", "rejected"]),
    phaseDiagnostics: projectTeamPhaseDiagnostics(input.phaseDiagnostics),
    transport: { ...counts(input.transport, ["requests", "responses", "maxDurationMs", "authorizationOk", "authorizationFailed", "sessionRevocations"]),
      proxyTimeouts: count(input.transport?.timeouts), timeline },
    cleanup
  };
  await mkdir(evidenceRoot, { recursive: true });
  const directory = await mkdtemp(join(evidenceRoot, "run-"));
  const path = join(directory, "receipt.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return path;
}
