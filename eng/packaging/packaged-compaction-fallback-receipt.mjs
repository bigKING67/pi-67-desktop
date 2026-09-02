export const PACKAGED_COMPACTION_FALLBACK_RECEIPT_SCHEMA = "pi67.packaged-compaction-fallback.v1";

export function assertPackagedCompactionFallbackReceipt(receipt) {
  assert(receipt?.schema === PACKAGED_COMPACTION_FALLBACK_RECEIPT_SCHEMA, "Unexpected compaction receipt schema.");
  assert(receipt?.status === "passed", "Compaction receipt must be passed.");
  assert(receipt?.evidenceLevel === "packaged-electron-runtime", "Compaction receipt must come from packaged Electron.");
  assert(receipt?.isolation?.canonicalMutationEventCount === 0, "Canonical Pi Session root changed during the isolated run.");
  assert(receipt?.isolation?.isolatedSessionCount === 1, "Exactly one isolated Pi Session is required.");
  assert(receipt?.isolation?.sessionPathContained === true, "The synthetic Session escaped the isolated Agent Directory.");
  assert(receipt?.openViking?.state === "unavailable", "OpenViking must be unavailable throughout this receipt.");
  assert(receipt?.openViking?.connectionAttempts > 0, "The packaged runtime did not attempt the unavailable OpenViking endpoint.");
  assert(receipt?.openViking?.successfulResponses === 0, "The unavailable OpenViking endpoint unexpectedly succeeded.");
  assert(receipt?.piCompaction?.trigger === "threshold", "Pi auto-compaction must be threshold-triggered.");
  assert(receipt?.piCompaction?.entryCount === 1, "Exactly one Pi JSONL compaction entry is required.");
  assert(receipt?.piCompaction?.fromExtension === false, "The compaction entry must come from Pi's default implementation.");
  assert(receipt?.piCompaction?.summaryMarkerObserved === true, "The default Pi compaction summary was not persisted.");
  assert(receipt?.piCompaction?.summaryProviderCallCount >= 1, "Pi did not call the default summarization provider path.");
  assert(receipt?.piCompaction?.beforeEventCount >= 1, "Pi did not emit session_before_compact.");
  assert(receipt?.piCompaction?.afterEventCount >= 1, "Pi did not emit session_compact.");
  assert(receipt?.piCompaction?.afterFromExtension?.every((value) => value === false), "Pi reported Extension-owned compaction.");
  assert(receipt?.continuity?.continuedTurnObserved === true, "A Turn did not complete after compaction.");
  assert(receipt?.continuity?.resumeTurnObserved === true, "A Turn did not complete after packaged restart Resume.");
  assert(receipt?.continuity?.packagedLaunchCount === 2, "The same isolated profile must be launched twice.");
  assert(receipt?.continuity?.distinctSessionIdHashes === 1, "Restart did not Resume the same Pi Session.");
  assert(receipt?.privacy?.credentialValueCountInJsonl === 0, "A runtime credential entered Pi JSONL.");
  assert(receipt?.cleanup?.isolatedProfileRemoved === true, "The isolated packaged profile was not removed.");
  assert(receipt?.cleanup?.unavailableEndpointClosed === true, "The synthetic unavailable endpoint was not closed.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
