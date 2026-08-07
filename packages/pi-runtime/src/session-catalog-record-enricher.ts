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
    return { ...record, ...this.organizationStore.get(sourceKey, record.fileIdentity) };
  }

  withOrganizations(sourceKey: string, records: SessionCatalogRecord[]): SessionCatalogRecord[] {
    return records.map((record) => this.withOrganization(sourceKey, record));
  }

  withCachedAutomaticTitles(records: SessionCatalogRecord[]): SessionCatalogRecord[] {
    return records.map((record) => {
      if (record.explicitName !== undefined) return record;
      const automaticName = this.automaticTitles.peek(record.path);
      return automaticName === undefined ? record : { ...record, automaticName };
    });
  }

  queueAutomaticTitles(records: SessionCatalogRecord[], onTitleChanged: () => void): void {
    this.automaticTitles.enqueue(
      records.filter((record) => record.explicitName === undefined).map((record) => record.path),
      onTitleChanged
    );
  }

  async organize(
    sourceKey: string,
    fileIdentity: string,
    mutation: { kind: "pin" | "archive"; value: boolean },
    now: number
  ): Promise<SessionCatalogOrganization> {
    const current = this.organizationStore.get(sourceKey, fileIdentity);
    if (mutation.kind === "pin" && mutation.value && current.archivedAt !== undefined) {
      throw new RuntimeError("INVALID_PAYLOAD", "Archived conversations must be restored before pinning.");
    }
    const organization = mutation.kind === "archive"
      ? mutation.value ? { archivedAt: now } : {}
      : mutation.value
        ? { ...current, pinnedAt: now }
        : current.archivedAt === undefined ? {} : { archivedAt: current.archivedAt };
    await this.organizationStore.set(sourceKey, fileIdentity, organization);
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
