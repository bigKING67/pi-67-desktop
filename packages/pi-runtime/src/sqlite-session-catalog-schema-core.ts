interface StatementLike {
  all(...values: SqlValue[]): Record<string, unknown>[];
  get(...values: SqlValue[]): Record<string, unknown> | undefined;
  run(...values: SqlValue[]): unknown;
}

export interface DatabaseLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
}

export interface DatabaseConstructor {
  new(location: string): DatabaseLike;
}

export type SqlValue = null | number | string;

export class SchemaMismatchError extends Error {}
export class CorruptCatalogError extends Error {}

export function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}
