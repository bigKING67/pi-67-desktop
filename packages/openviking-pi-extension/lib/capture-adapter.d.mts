export function extractBranchCapturePayloads(
  branch: any[],
  syncedEntryCount?: number,
  cfg?: Record<string, any>,
  expectedPrefixHash?: string,
): {
  payloads: any[];
  prefixHashes: string[];
  nextEntryCount: number;
  observedEntryCount: number;
  observedCaptureCount: number;
  currentPrefixHash: string;
  resetWatermark: boolean;
};
