import { describe, expect, it } from "vitest";
import { productionDependencyAuditReport } from "./audit-production-dependencies.mjs";

describe("production dependency audit report", () => {
  it("passes only a successful audit without high or critical advisories", () => {
    const report = productionDependencyAuditReport({
      advisories: {},
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
        dependencies: 393,
        optionalDependencies: 25,
        totalDependencies: 418
      }
    }, 0, "2026-08-17T00:00:00.000Z");

    expect(report).toMatchObject({
      schema: "pi67.production-dependency-audit.v1",
      passed: true,
      vulnerabilities: { high: 0, critical: 0 },
      totalDependencies: 418
    });
  });

  it("fails closed when the audit reports a high advisory", () => {
    const report = productionDependencyAuditReport({
      advisories: { advisory: { severity: "high" } },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        dependencies: 1,
        optionalDependencies: 0,
        totalDependencies: 1
      }
    }, 1, "2026-08-17T00:00:00.000Z");

    expect(report.passed).toBe(false);
  });

  it("fails closed when pnpm does not return the expected vulnerability metadata", () => {
    expect(() => productionDependencyAuditReport({ error: "registry unavailable" }, 1))
      .toThrow("pnpm audit did not return vulnerability metadata");
  });
});
