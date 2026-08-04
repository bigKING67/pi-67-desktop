import type { SessionCatalogDegradedReason } from "@pi67/domain";
import type {
  OpenSqliteSessionCatalog,
  SqliteSessionCatalog
} from "./sqlite-session-catalog.js";

const SQLITE_RETRY_MS = { initial: 1_000, maximum: 30_000 };

export class SessionCatalogSqliteLifecycle {
  private catalogValue: SqliteSessionCatalog | undefined;
  private attempted = false;
  private retryAt = 0;
  private retryMs = SQLITE_RETRY_MS.initial;
  private degradedReasonValue: SessionCatalogDegradedReason | undefined;
  private openFlight: Promise<boolean> | undefined;

  constructor(
    private readonly directory: string | undefined,
    private readonly storageRoot: string | undefined,
    private readonly openSqlite: OpenSqliteSessionCatalog,
    private readonly now: () => number
  ) {}

  get catalog(): SqliteSessionCatalog | undefined {
    return this.catalogValue;
  }

  get degradedReason(): SessionCatalogDegradedReason | undefined {
    return this.degradedReasonValue;
  }

  async ensure(isCurrent: () => boolean): Promise<boolean> {
    if (this.catalogValue || this.directory === undefined || !isCurrent()) return false;
    if (this.openFlight) return this.openFlight;
    const now = this.now();
    if (this.attempted && now < this.retryAt) return false;
    this.attempted = true;
    const flight = this.openSqlite(this.directory, this.storageRoot)
      .catch(() => ({
        kind: "fallback" as const,
        reason: "unavailable" as const,
        degradedReason: "unavailable" as const
      }))
      .then((result) => {
        if (!isCurrent()) {
          if (result.kind === "ready") result.catalog.close();
          return false;
        }
        if (result.kind === "ready") {
          this.catalogValue = result.catalog;
          this.degradedReasonValue = undefined;
          this.retryMs = SQLITE_RETRY_MS.initial;
          return true;
        }
        this.degradedReasonValue = result.degradedReason ?? result.reason;
        this.retryAt = now + this.retryMs;
        this.retryMs = Math.min(this.retryMs * 2, SQLITE_RETRY_MS.maximum);
        return false;
      })
      .finally(() => {
        if (this.openFlight === flight) this.openFlight = undefined;
      });
    this.openFlight = flight;
    return flight;
  }

  demote(): void {
    try {
      this.catalogValue?.close();
    } catch {
      // The projection is disposable; fallback stays metadata-only.
    }
    this.catalogValue = undefined;
    this.degradedReasonValue = "runtime-query";
    this.retryAt = this.now() + this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, SQLITE_RETRY_MS.maximum);
  }

  close(): void {
    try {
      this.catalogValue?.close();
    } catch {
      // Shutdown remains safe even if SQLite is already closed.
    }
    this.catalogValue = undefined;
  }
}
