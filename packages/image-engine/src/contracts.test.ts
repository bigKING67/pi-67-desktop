import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileImageJob, validateExecutionReceipt, validateImageJob } from "./contracts.js";
import type { JsonRecord } from "./document.js";

// Golden cases produced by the canonical creative-craft Python validator and
// compiler (craft67 8e2a37f8) on 2026-10-09. Parity is exact: same verdict,
// same error messages in the same order, and byte-identical compiled packs.
interface Fixture { job?: JsonRecord; receipt?: JsonRecord; valid: boolean; errors: string[]; warnings: string[]; pack?: string; fence_count?: number }
const fixtures = JSON.parse(readFileSync(new URL("./test-support/contract-fixtures.json", import.meta.url), "utf8")) as Record<string, Fixture>;

describe("canonical image contracts parity", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(name, () => {
      const subject = fixture.job ?? fixture.receipt;
      const result = fixture.job ? validateImageJob(subject) : validateExecutionReceipt(subject);
      expect(result.valid).toBe(fixture.valid);
      expect(result.errors).toEqual(fixture.errors);
      expect(result.warnings).toEqual(fixture.warnings);
      if (fixture.pack === undefined || !fixture.job) return;
      if (fixture.fence_count === 2) expect(compileImageJob(fixture.job).pack).toBe(fixture.pack);
      else expect(() => compileImageJob(fixture.job as JsonRecord)).toThrow(/code fences/);
    });
  }

  it("covers every fixture kind", () => {
    const names = Object.keys(fixtures);
    expect(names.filter((name) => fixtures[name]?.job)).toHaveLength(27);
    expect(names.filter((name) => fixtures[name]?.receipt)).toHaveLength(11);
  });

  it("extracts the single fenced prompt block", () => {
    const fixture = fixtures["ready-edit-full"];
    if (!fixture?.job) throw new Error("missing fixture");
    const { prompt } = compileImageJob(fixture.job);
    expect(prompt.startsWith("### INTENDED USE AND OUTPUT")).toBe(true);
    expect(prompt).toContain('- "春日焕新" — top left; bold sans');
    expect(prompt).toContain("### PRESERVE EXACTLY");
    expect(prompt).not.toContain("```");
  });

  it("rejects non-object artifacts and missing timezone offsets", () => {
    expect(validateImageJob([]).errors).toEqual(["artifact must be an object"]);
    const receipt = fixtures["receipt-ok"]?.receipt;
    if (!receipt) throw new Error("missing fixture");
    expect(validateExecutionReceipt({ ...receipt, started_at: "2026-10-08T00:00:00" }).errors).toEqual(["started_at must include a timezone offset or Z"]);
    expect(validateExecutionReceipt({ ...receipt, completed_at: "2026-10-07T00:00:00Z" }).errors).toEqual(["completed_at must be at or after started_at"]);
  });
});
