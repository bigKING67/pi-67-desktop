import { RuntimeError } from "@pi67/domain";
import { ConversationOrganizationStore } from "./conversation-organization-store.js";
import { SessionAutomaticTitleReader } from "./session-automatic-title.js";
import { sortSessionCatalogRecords } from "./session-catalog-projection.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

export interface SessionCatalogOrganization {
  pinnedAt?: number;
  archivedAt?: number;
}

export class SessionCatalogRecordEnricher {
  private readonly automaticTitles = new SessionAutomaticTitleReader();
  private readonly organizationStore: ConversationOrganizationStore;

  constructor(storageRoot?: string) {
    this.organizationStore = new ConversationOrganizationStore(storageRoot);
  }

  initialize(): Promise<void> {
    return this.organizationStore.initialize();
  }

  clear(): void {
    this.automaticTitles.clear();
  }

  withOrganization(sourceKey: string, record: SessionCatalogRecord): SessionCatalogRecord {
    return { ...record, ...this.organizationStore.get(sourceKey, record.path) };
  }

  withOrganizations(sourceKey: string, records: SessionCatalogRecord[]): SessionCatalogRecord[] {
    return records.map((record) => this.withOrganization(sourceKey, record));
  }

  async withAutomaticTitles(records: SessionCatalogRecord[]): Promise<SessionCatalogRecord[]> {
    const output = [...records];
    const workerCount = Math.min(4, output.length);
    let next = 0;
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (next < output.length) {
        const index = next++;
        const record = output[index];
        if (!record || record.explicitName !== undefined) continue;
        const automaticName = await this.automaticTitles.read(record.path);
        if (automaticName !== undefined) output[index] = { ...record, automaticName };
      }
    }));
    return output;
  }

  async organize(
    sourceKey: string,
    path: string,
    mutation: { kind: "pin" | "archive"; value: boolean },
    now: number
  ): Promise<SessionCatalogOrganization> {
    const current = this.organizationStore.get(sourceKey, path);
    if (mutation.kind === "pin" && mutation.value && current.archivedAt !== undefined) {
      throw new RuntimeError("INVALID_PAYLOAD", "Archived conversations must be restored before pinning.");
    }
    const organization = mutation.kind === "archive"
      ? mutation.value ? { archivedAt: now } : {}
      : mutation.value
        ? { ...current, pinnedAt: now }
        : current.archivedAt === undefined ? {} : { archivedAt: current.archivedAt };
    await this.organizationStore.set(sourceKey, path, organization);
    return organization;
  }

  applyOrganization(
    records: SessionCatalogRecord[],
    path: string,
    organization: SessionCatalogOrganization
  ): SessionCatalogRecord[] {
    return sortSessionCatalogRecords(records.map((record) => {
      if (record.path !== path) return record;
      const next = { ...record };
      delete next.pinnedAt;
      delete next.archivedAt;
      if (organization.pinnedAt !== undefined) next.pinnedAt = organization.pinnedAt;
      if (organization.archivedAt !== undefined) next.archivedAt = organization.archivedAt;
      return next;
    }));
  }
}
