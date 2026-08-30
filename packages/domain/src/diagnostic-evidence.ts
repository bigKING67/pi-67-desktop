export interface BoundedDiagnosticEvidenceSnapshot<T> {
  entries: T[];
  droppedCount: number;
}

/**
 * Keeps only the newest diagnostic observations in memory. Callers own the
 * privacy-safe entry shape; this class owns the deterministic size bound.
 */
export class BoundedDiagnosticEvidence<T> {
  private readonly entries: T[] = [];
  private droppedCount = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("Diagnostic evidence capacity must be a positive integer.");
    }
  }

  record(entry: T): void {
    if (this.entries.length === this.capacity) {
      this.entries.shift();
      this.droppedCount = Math.min(Number.MAX_SAFE_INTEGER, this.droppedCount + 1);
    }
    this.entries.push(entry);
  }

  snapshot(clone: (entry: T) => T): BoundedDiagnosticEvidenceSnapshot<T> {
    return {
      entries: this.entries.map(clone),
      droppedCount: this.droppedCount
    };
  }
}
