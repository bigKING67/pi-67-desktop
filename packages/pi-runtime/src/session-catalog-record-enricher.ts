import { RuntimeError } from "@pi67/domain";
import { ConversationOrganizationStore } from "./conversation-organization-store.js";
import { SessionAutomaticTitleReader } from "./session-automatic-title.js";
import { sortSessionCatalogRecords } from "./session-catalog-projection.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

export interface SessionCatalogOrganization {
  pinnedAt?: number;
  archivedAt?: number;
  snoozedUntil?: number;
}

export type SessionCatalogOrganizationMutation =
  | { kind: "pin" | "archive"; value: boolean }
  | { kind: "snooze"; value: number | undefined };

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
    mutation: SessionCatalogOrganizationMutation,
    now: number
  ): Promise<SessionCatalogOrganization> {
    const current = this.organizationStore.get(sourceKey, fileIdentity);
    if (mutation.kind === "pin" && mutation.value && current.archivedAt !== undefined) {
      throw new RuntimeError("INVALID_PAYLOAD", "Archived conversations must be restored before pinning.");
    }
    if (mutation.kind === "snooze" && current.archivedAt !== undefined) {
      throw new RuntimeError("INVALID_PAYLOAD", "Archived conversations must be restored before snoozing.");
    }
    const organization: SessionCatalogOrganization = mutation.kind === "archive"
      ? mutation.value ? { archivedAt: now } : {}
      : mutation.kind === "snooze"
        ? mutation.value === undefined
          ? organizationWithout(current, "snoozedUntil")
          : { snoozedUntil: mutation.value }
      : mutation.value
        ? {
            ...organizationWithout(current, "snoozedUntil"),
            pinnedAt: Math.max(now, this.organizationStore.highestPinnedAt() + 1)
          }
        : organizationWithout(current, "pinnedAt");
    await this.organizationStore.set(sourceKey, fileIdentity, organization);
    return organization;
  }

  async reorderPinned(
    sourceKey: string,
    records: readonly SessionCatalogRecord[],
    orderedPaths: readonly string[],
    now: number
  ): Promise<Map<string, SessionCatalogOrganization>> {
    const byPath = new Map(records.map((record) => [record.path, record]));
    // Every pinned item is reassigned, so reordering does not need to grow an
    // unbounded timestamp sequence above the previous maximum.
    const top = Math.max(now, orderedPaths.length);
    const updates = orderedPaths.map((path, index) => {
      const record = byPath.get(path);
      if (!record || record.pinnedAt === undefined || record.archivedAt !== undefined) {
        throw new RuntimeError("INVALID_PAYLOAD", "Pinned conversation order is stale.");
      }
      const organization = { pinnedAt: top - index };
      return { record, organization };
    });
    await this.organizationStore.setMany(sourceKey, updates.map(({ record, organization }) => ({
      fileIdentity: record.fileIdentity,
      value: organization
    })));
    return new Map(updates.map(({ record, organization }) => [record.path, organization]));
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
      delete next.snoozedUntil;
      if (organization.pinnedAt !== undefined) next.pinnedAt = organization.pinnedAt;
      if (organization.archivedAt !== undefined) next.archivedAt = organization.archivedAt;
      if (organization.snoozedUntil !== undefined) next.snoozedUntil = organization.snoozedUntil;
      return next;
    }));
  }

  applyOrganizations(
    records: SessionCatalogRecord[],
    organizations: ReadonlyMap<string, SessionCatalogOrganization>
  ): SessionCatalogRecord[] {
    return sortSessionCatalogRecords(records.map((record) => {
      const organization = organizations.get(record.path);
      if (!organization) return record;
      const next = { ...record };
      delete next.pinnedAt;
      delete next.archivedAt;
      delete next.snoozedUntil;
      if (organization.pinnedAt !== undefined) next.pinnedAt = organization.pinnedAt;
      if (organization.archivedAt !== undefined) next.archivedAt = organization.archivedAt;
      if (organization.snoozedUntil !== undefined) next.snoozedUntil = organization.snoozedUntil;
      return next;
    }));
  }
}

function organizationWithout(
  organization: SessionCatalogOrganization,
  key: keyof SessionCatalogOrganization
): SessionCatalogOrganization {
  const next = { ...organization };
  delete next[key];
  return next;
}
