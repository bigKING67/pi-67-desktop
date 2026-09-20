import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { packagedTeamQueryStages, writePackagedTeamSessionReceipt } from "./packaged-team-session-receipt.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root() { const path = await mkdtemp(join(tmpdir(), "team-session-receipt-")); roots.push(path); return path; }
const base = { asarSha256: "a".repeat(64), native: true, passed: true, cleanupCompleted: true, closed: true,
  profileRemoved: true, stage: "cold-signed-out", stageElapsedMs: 24 };

it("keeps a failed run independently of later successful runs and excludes credentials, identities and bodies", async () => {
  const evidence = await root();
  const secret = "synthetic-sensitive-value";
  const failed = await writePackagedTeamSessionReceipt(evidence, { ...base, passed: false, profileRemoved: false,
    stage: "team-session", failureKind: "AssertionError", queryStages: ["index-preparation", secret, "index-preparation"],
    queryEmbeddingRequests: 0, queryAfterRequestSequence: 32, error: new Error(secret), profile: secret,
    model: { agent: 3, embedding: 15, extraction: 0, rejected: 0, endpoint: secret },
    transport: { requests: 49, responses: 48, timeouts: 0, headers: secret,
      timeline: [{ sequence: 49, operation: "sync", elapsedMs: 8002, status: 0, closed: true, url: secret, body: secret }] } });
  const before = await readFile(failed, "utf8");
  const successful = await writePackagedTeamSessionReceipt(evidence, base);
  expect(successful).not.toBe(failed);
  expect(await readFile(failed, "utf8")).toBe(before);
  expect(before).not.toContain(secret);
  expect(JSON.parse(before)).toMatchObject({ status: "FAILED", asarSha256: base.asarSha256, failureKind: "AssertionError",
    query: { stages: ["index-preparation"], embeddingRequestsSinceStart: 0, afterRequestSequence: 32 },
    transport: { requests: 49, responses: 48, proxyTimeouts: 0,
      timeline: [{ sequence: 49, operation: "sync", elapsedMs: 8002, status: null, closed: true }] },
    cleanup: { completed: true, electronClosed: true, profileRemoved: false } });
  expect(JSON.parse(await readFile(successful, "utf8"))).toMatchObject({ status: "PASS", mode: "native" });
  if (process.platform !== "win32") expect((await stat(failed)).mode & 0o777).toBe(0o600);
});

it.each(["passed", "cleanupCompleted", "closed", "profileRemoved"])("never records PASS with incomplete %s", async field => {
  const path = await writePackagedTeamSessionReceipt(await root(), { ...base, [field]: false });
  expect(JSON.parse(await readFile(path, "utf8")).status).toBe("FAILED");
});

it("bounds transport evidence and labels unavailable diagnostics without guessing a query stage", async () => {
  const evidence = await root();
  const input = { ...base, passed: false, native: false, stage: "untrusted-stage", failureKind: "untrusted-error", stageElapsedMs: Infinity,
    transport: { requests: "untrusted", timeline: Array.from({ length: 300 }, (_, sequence) => ({
      sequence, operation: "untrusted-url", elapsedMs: -1, status: "untrusted", closed: false })) } };
  const receipt = JSON.parse(await readFile(await writePackagedTeamSessionReceipt(evidence, input), "utf8"));
  expect(receipt).toMatchObject({ mode: "non-native", stage: "unknown", failureKind: "unknown", stageElapsedMs: null,
    query: { stages: [], embeddingRequestsSinceStart: null, afterRequestSequence: null }, transport: { requests: null } });
  expect(receipt.transport.timeline).toHaveLength(128);
  expect(receipt.transport.timeline[0]).toEqual({ sequence: 172, operation: "other", elapsedMs: null, status: null, closed: false });
  expect(JSON.stringify(receipt)).not.toContain("untrusted");
  expect(JSON.stringify(receipt).length).toBeLessThan(20_000);
});

it("rejects a missing artifact identity instead of producing unattributed acceptance evidence", async () => {
  await expect(writePackagedTeamSessionReceipt(await root(), { ...base, asarSha256: "unknown" })).rejects.toThrow("exact asar hash");
});

it("extracts fixed stages only from failed Tool results and retains no original text", () => {
  const text = "Shared knowledge query unavailable. Stage: native-query. synthetic-sensitive-value";
  const entry = (role, isError, value = text) => ({ type: "message", message: { role, isError, content: [{ type: "text", text: value }] } });
  expect(packagedTeamQueryStages([entry("assistant", true), entry("toolResult", false)])).toEqual([]);
  expect(packagedTeamQueryStages([entry("toolResult", true), entry("toolResult", true),
    entry("toolResult", true, "Shared knowledge query unavailable. Stage: not-a-fixed-phase.")])).toEqual(["native-query"]);
});

it("persists bounded phase diagnostics while rejecting raw or extended records", async () => {
  const diagnostic = { schema: "new-money.team-read.v1", outcome: "failed", durationMs: 8001,
    stages: [{ stage: "reader-admission", durationMs: 8001 }] };
  const path = await writePackagedTeamSessionReceipt(await root(), { ...base, passed: false,
    phaseDiagnostics: [{ ...diagnostic, credential: "synthetic-sensitive-value" }, diagnostic, "synthetic-sensitive-value"] });
  const receipt = await readFile(path, "utf8");
  expect(JSON.parse(receipt).phaseDiagnostics).toEqual([diagnostic]);
  expect(receipt).not.toContain("synthetic-sensitive-value");
});
