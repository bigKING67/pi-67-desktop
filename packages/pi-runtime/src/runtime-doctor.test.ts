import type { SessionCatalogStatus } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { createDoctorReport } from "./runtime-doctor.js";

describe("Runtime Doctor Session Catalog status", () => {
  it("warns when a ready Catalog is incomplete", async () => {
    const report = await createDoctorReport(undefined, undefined, status({ incomplete: true, skippedCount: 2 }));
    expect(report.checks.find((check) => check.id === "session-catalog")?.status).toBe("warning");
  });

  it("passes only a complete, settled ready Catalog", async () => {
    const report = await createDoctorReport(undefined, undefined, status());
    expect(report.checks.find((check) => check.id === "session-catalog")?.status).toBe("pass");
  });
});

function status(overrides: Partial<SessionCatalogStatus> = {}): SessionCatalogStatus {
  return {
    revision: 1,
    itemCount: 1,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    ...overrides
  };
}
