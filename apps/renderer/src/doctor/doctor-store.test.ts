import type { DoctorReport } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import { doctorStore } from "./doctor-store.js";

const report: DoctorReport = {
  generatedAt: 1,
  checks: [{ id: "node", label: "Node", status: "pass", detail: "ok" }]
};

describe("doctor store", () => {
  afterEach(() => {
    doctorStore.setState(doctorStore.getInitialState(), true);
  });

  it("owns the Doctor run lifecycle without an App Store mirror", () => {
    doctorStore.getState().begin();
    expect(doctorStore.getState()).toMatchObject({
      report: undefined,
      running: true,
      error: undefined
    });

    doctorStore.getState().complete(report);
    expect(doctorStore.getState()).toMatchObject({
      report,
      running: false,
      error: undefined
    });
  });

  it("keeps a failed run retryable", () => {
    doctorStore.getState().begin();
    doctorStore.getState().fail("Doctor unavailable");

    expect(doctorStore.getState()).toMatchObject({
      running: false,
      error: "Doctor unavailable"
    });
  });
});
