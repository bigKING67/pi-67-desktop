import { describe, expect, it } from "vitest";
import { fingerprintSchemaSql, SchemaSqlFingerprintError } from "./sqlite-schema-fingerprint.js";

describe("SQLite schema SQL fingerprint", () => {
  it("ignores unquoted case, whitespace, and comments without losing token boundaries", () => {
    const canonical = "CREATE TABLE records (value TEXT NOT NULL CHECK (value = 'Exact Value')) STRICT";
    const formatted = `
      create /* structural comment */ table records (
        value text not -- constraint follows
        null check (value = 'Exact Value')
      ) strict
    `;

    expect(fingerprintSchemaSql(formatted)).toBe(fingerprintSchemaSql(canonical));
    expect(fingerprintSchemaSql("SELECT NOT NULL")).not.toBe(fingerprintSchemaSql("SELECT NOTNULL"));
  });

  it("preserves quoted values, quoted identifiers, blob literals, and adjacency", () => {
    expect(fingerprintSchemaSql("CHECK (value = 'Exact Value')"))
      .not.toBe(fingerprintSchemaSql("CHECK (value = 'exact value')"));
    expect(fingerprintSchemaSql('CREATE TABLE "Records" (value TEXT)'))
      .not.toBe(fingerprintSchemaSql('CREATE TABLE "records" (value TEXT)'));
    expect(fingerprintSchemaSql("CHECK (value = X'ABCD')"))
      .not.toBe(fingerprintSchemaSql("CHECK (value = x 'ABCD')"));
  });

  it.each([
    "CREATE TABLE records (value TEXT /* unterminated",
    "CREATE TABLE records (value TEXT CHECK (value = 'unterminated))",
    "CREATE TABLE [records (value TEXT)"
  ])("rejects malformed schema SQL: %s", (sql) => {
    expect(() => fingerprintSchemaSql(sql)).toThrow(SchemaSqlFingerprintError);
  });

  it("rejects oversized schema SQL", () => {
    expect(() => fingerprintSchemaSql(`CREATE TABLE records (${"x".repeat(33 * 1024)})`))
      .toThrow(SchemaSqlFingerprintError);
  });
});
