export interface SessionCatalogRecord {
  fileIdentity: string;
  id: string;
  path: string;
  cwd: string;
  cwdKey: string;
  explicitName?: string;
  automaticName?: string;
  automaticNameSource?: "generated" | "seed";
  pinnedAt?: number;
  archivedAt?: number;
  snoozedUntil?: number;
  modifiedAt: number;
  messageCount: number;
  parentSessionPath?: string;
}

export interface SqliteCatalogState {
  sourceKey: string;
  revision: number;
  reconciledAt?: number;
  itemCount: number;
  incomplete: boolean;
  skippedCount: number;
}
