import type { SessionCatalogStatus } from "@pi67/domain";

export interface RuntimeDiagnostics {
  generatedAt: number;
  application: string;
  piSdkVersion: string;
  platform: string;
  architecture: string;
  node: string;
  workspace?: { pathHash: string; pathKind: "drive" | "unc" | "posix" };
  sessionConfigured: boolean;
  sessionFileConfigured: boolean;
  model?: string;
  extensionCount: number;
  extensionErrors: Array<{ sourceHash: string; errorClass: string }>;
  host?: RuntimeHostDiagnostics;
}

export interface SessionCreationJournalDiagnostics {
  entryCount: number;
  stateCounts: Record<
    "reserved" | "materializing" | "materialized" | "published" | "acknowledged" | "ambiguous" | "abandoned",
    number
  >;
  invalidEntryCount: number;
  truncated: boolean;
}

export interface RuntimeHostDiagnostics {
  hostEpoch: number;
  taskCount: number;
  liveRuntimeCount: number;
  activeOperationCount: number;
  writerLeases: { activeCount: number; pendingCount: number; compromised: boolean };
  workspaces: Array<{
    workspaceIdHash: string;
    sessionCatalog: SessionCatalogStatus;
    sessionCreationJournal: SessionCreationJournalDiagnostics;
  }>;
  workspacesTruncated: boolean;
}
