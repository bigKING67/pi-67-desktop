import type { DoctorReport } from "@pi67/domain";
import type { DesktopRecoverySnapshot, RuntimeDiagnostics } from "@pi67/protocol";
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
      diagnostics: undefined,
      recovery: undefined,
      renderer: undefined,
      running: true,
      recoveryLoading: true,
      error: undefined
    });

    doctorStore.getState().complete(report);
    doctorStore.getState().finish();
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

  it("keeps Host and Desktop recovery projections independent", () => {
    doctorStore.getState().begin();
    doctorStore.getState().completeRecovery(recoverySnapshot);
    doctorStore.getState().completeDiagnostics(runtimeDiagnostics);
    doctorStore.getState().complete(report);
    doctorStore.getState().fail("Host response timed out after the event completed");

    expect(doctorStore.getState()).toMatchObject({
      report,
      diagnostics: runtimeDiagnostics,
      recovery: recoverySnapshot,
      running: false,
      recoveryLoading: false,
      error: "Host response timed out after the event completed"
    });
  });
});

const recoverySnapshot: DesktopRecoverySnapshot = {
  generatedAt: 2,
  previousRunExitStatus: "clean",
  workspaces: {
    total: 1,
    available: 1,
    missing: 0,
    identityChanged: 0,
    needsConfirmation: 0,
    unavailable: 0,
    trusted: 1,
    trustUnknown: 0,
    pathOnlyIdentity: 0
  },
  pendingSessionCreations: 0,
  attachmentStaging: { draftCount: 0, claimedCount: 0, invalidEntryCount: 0, truncated: false },
  health: {
    agentHost: {
      phase: "running",
      restartCount: 0,
      portHandoffCount: 1,
      poisonedRuntimeReplacementCount: 0,
      poisonedRuntimeReplacementPending: false
    },
    repository: {
      mutationScheduler: {
        queuedCount: 0,
        runningCount: 0,
        activeRepositoryCount: 0,
        fencedRepositoryCount: 0,
        disposed: false
      },
      gitRunner: { activeProcessCount: 0, disposed: false },
      workingTree: { cachedSnapshotCount: 0, disposed: false }
    },
    promptStashImages: { disposed: false }
  }
};

const runtimeDiagnostics: RuntimeDiagnostics = {
  generatedAt: 3,
  application: "π",
  piSdkVersion: "0.81.1",
  platform: "darwin",
  architecture: "arm64",
  node: "24.18.0",
  sessionConfigured: false,
  sessionFileConfigured: false,
  extensionCount: 0,
  extensionErrors: []
};
