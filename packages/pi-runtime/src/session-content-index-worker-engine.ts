import { join } from "node:path";
import { indexSessionContentRecords, searchIndexedSessionContent } from "./session-content-index.js";
import { openSqliteSessionCatalog, supportsSessionContentIndex, type IndexedSqliteSessionCatalog } from "./sqlite-session-catalog.js";
import { validateContentIndexRequest, type ContentIndexWorkerReply } from "./session-content-index-worker-contract.js";

/** Owns only the disposable mirror, never the foreground catalog connection. */
export class ContentIndexWorkerEngine {
  private catalog: IndexedSqliteSessionCatalog | undefined;
  constructor(private readonly directory: string, private readonly storageRoot?: string) {}

  async execute(value: unknown): Promise<ContentIndexWorkerReply> {
    const request = validateContentIndexRequest(value);
    if (!this.catalog) {
      const opened = await openSqliteSessionCatalog(join(this.directory, "content-index-worker"), this.storageRoot);
      if (opened.kind !== "ready") throw new Error("Content index is unavailable.");
      if (!supportsSessionContentIndex(opened.catalog)) {
        opened.catalog.close();
        throw new Error("Content index is unavailable.");
      }
      this.catalog = opened.catalog;
    }
    const sqlite = this.catalog;
    sqlite.replaceAll(request.sourceKey, [...request.records], {
      reconciledAt: Date.now(), incomplete: false, skippedCount: 0
    }, 0);
    await indexSessionContentRecords({
      records: request.records, sqlite,
      isCurrentFlight: () => true,
      isCurrent: () => true
    });
    if (!request.search) return { id: request.id, ok: true };
    const result = await searchIndexedSessionContent({
      ...request.search,
      records: request.records.filter(record => record.cwdKey === request.search!.workspaceKey && record.archivedAt === undefined),
      sqlite
    });
    for (const identity of result.staleFileIdentities) sqlite.removeContentIndex(identity);
    return { id: request.id, ok: true, result };
  }

  close(): void {
    this.catalog?.close();
    this.catalog = undefined;
  }
}
