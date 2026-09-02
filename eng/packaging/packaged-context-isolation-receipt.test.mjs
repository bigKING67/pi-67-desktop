import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPackagedContextIsolationReceipt,
  collectIsolatedSessionEvidence,
  PACKAGED_CONTEXT_ISOLATION_RECEIPT_SCHEMA,
  snapshotDirectoryMetadata,
  watchDirectoryMutationDigests
} from "./packaged-context-isolation-receipt.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged context isolation receipt", () => {
  it("accepts one contained synthetic Session with an empty isolated recall", async () => {
    const root = await fixtureRoot();
    const sessionDirectory = join(root, "agent", "sessions", "workspace");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, "session.jsonl"), [
      JSON.stringify({ type: "session", id: "synthetic-session" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "synthetic" } }),
      ""
    ].join("\n"));
    const metadata = await snapshotDirectoryMetadata(sessionDirectory);
    const isolatedSessions = await collectIsolatedSessionEvidence(join(root, "agent"));
    const receipt = validReceipt({ isolatedSessions, metadata });
    expect(() => assertPackagedContextIsolationReceipt(receipt)).not.toThrow();
  });

  it("rejects canonical Session mutations and recalled Memory", async () => {
    const root = await fixtureRoot();
    const sessionDirectory = join(root, "canonical-sessions");
    await mkdir(sessionDirectory);
    const before = await snapshotDirectoryMetadata(sessionDirectory);
    const probe = watchDirectoryMutationDigests(sessionDirectory);
    await writeFile(join(sessionDirectory, "unexpected.jsonl"), "{}\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    probe.close();
    const after = await snapshotDirectoryMetadata(sessionDirectory);
    const receipt = validReceipt({ isolatedSessions: [], metadata: before });
    receipt.canonicalSessionRoot = {
      before,
      after,
      mutationEventCount: probe.observations.length,
      mutationPathDigests: probe.observations.map((entry) => entry.pathSha256)
    };
    receipt.modelContext.memoryContextBlockCount = 1;
    expect(() => assertPackagedContextIsolationReceipt(receipt)).toThrow(/canonical Session root|recalled Memory/u);
  });

  it("allows protocol token budgets but rejects authentication material", () => {
    const metadata = { exists: true, inode: "1" };
    const receipt = validReceipt({
      isolatedSessions: [{
        relativePath: "sessions/synthetic/session.jsonl",
        sha256: "a".repeat(64),
        entryCount: 2
      }],
      metadata
    });
    receipt.openViking.requestBoundaries = [{ path: "/context?token_budget=1024" }];
    expect(() => assertPackagedContextIsolationReceipt(receipt)).not.toThrow();
    receipt.openViking.apiKey = "must-not-appear";
    expect(() => assertPackagedContextIsolationReceipt(receipt)).toThrow(/credential material/u);
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "pi67-isolation-receipt-"));
  roots.push(root);
  return root;
}

function validReceipt({ isolatedSessions, metadata }) {
  return {
    schema: PACKAGED_CONTEXT_ISOLATION_RECEIPT_SCHEMA,
    status: "passed",
    evidenceLevel: "packaged-electron-runtime",
    isolation: { allPathsContained: true },
    canonicalSessionRoot: {
      before: metadata,
      after: metadata,
      mutationEventCount: 0,
      mutationPathDigests: []
    },
    isolatedSessions,
    openViking: {
      transport: "isolated-loopback-double",
      healthObserved: true,
      searchObserved: true,
      nonSyntheticIdentityCount: 0,
      returnedRecallEntries: 0
    },
    modelContext: { memoryContextBlockCount: 0 },
    cleanup: { isolatedProfileRemoved: true, openVikingDoubleClosed: true }
  };
}
