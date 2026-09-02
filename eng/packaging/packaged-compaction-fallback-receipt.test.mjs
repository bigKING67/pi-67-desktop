import { describe, expect, it } from "vitest";
import {
  assertPackagedCompactionFallbackReceipt,
  PACKAGED_COMPACTION_FALLBACK_RECEIPT_SCHEMA
} from "./packaged-compaction-fallback-receipt.mjs";

function validReceipt() {
  return {
    schema: PACKAGED_COMPACTION_FALLBACK_RECEIPT_SCHEMA,
    status: "passed",
    evidenceLevel: "packaged-electron-runtime",
    isolation: {
      canonicalMutationEventCount: 0,
      isolatedSessionCount: 1,
      sessionPathContained: true
    },
    openViking: {
      state: "unavailable",
      connectionAttempts: 2,
      successfulResponses: 0
    },
    piCompaction: {
      trigger: "threshold",
      entryCount: 1,
      fromExtension: false,
      summaryMarkerObserved: true,
      summaryProviderCallCount: 1,
      beforeEventCount: 1,
      afterEventCount: 1,
      afterFromExtension: [false]
    },
    continuity: {
      continuedTurnObserved: true,
      resumeTurnObserved: true,
      packagedLaunchCount: 2,
      distinctSessionIdHashes: 1
    },
    privacy: { credentialValueCountInJsonl: 0 },
    cleanup: { isolatedProfileRemoved: true, unavailableEndpointClosed: true }
  };
}

describe("packaged compaction fallback receipt", () => {
  it("accepts a threshold-triggered Pi default compaction with Turn and Resume continuity", () => {
    expect(() => assertPackagedCompactionFallbackReceipt(validReceipt())).not.toThrow();
  });

  it("rejects Extension-owned compaction", () => {
    const receipt = validReceipt();
    receipt.piCompaction.fromExtension = true;
    expect(() => assertPackagedCompactionFallbackReceipt(receipt))
      .toThrow("Pi's default implementation");
  });

  it("rejects canonical Session mutations or missing restart Resume", () => {
    const canonicalMutation = validReceipt();
    canonicalMutation.isolation.canonicalMutationEventCount = 1;
    expect(() => assertPackagedCompactionFallbackReceipt(canonicalMutation))
      .toThrow("Canonical Pi Session root changed");

    const changedSession = validReceipt();
    changedSession.continuity.distinctSessionIdHashes = 2;
    expect(() => assertPackagedCompactionFallbackReceipt(changedSession))
      .toThrow("Resume the same Pi Session");
  });
});
