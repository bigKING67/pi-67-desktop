import { describe, expect, it } from "vitest";
import { parseDesktopUpdateState } from "./desktop-update-state.js";

const available = {
  phase: "available",
  channel: "unsigned-preview",
  currentVersion: "0.1.0-alpha.1",
  version: "0.1.0-alpha.2",
  artifactName: "Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe",
  artifactBytes: 1_000,
  automaticChecks: true
} as const;

describe("desktop update state contract", () => {
  it("accepts every canonical phase and normalizes checkedAt", () => {
    expect(parseDesktopUpdateState({ ...available, checkedAt: "2026-08-20T08:00:00Z" }))
      .toEqual({ ok: true, state: { ...available, checkedAt: "2026-08-20T08:00:00.000Z" } });
    expect(parseDesktopUpdateState({ ...available, phase: "downloading", transferred: 1_000, percent: 100 }).ok).toBe(true);
    expect(parseDesktopUpdateState({ phase: "idle", channel: "unsigned-preview", currentVersion: "1", automaticChecks: false }).ok)
      .toBe(true);
    expect(parseDesktopUpdateState({ phase: "error", channel: "unsigned-preview", currentVersion: "1",
      automaticChecks: true, detail: "offline" }).ok).toBe(true);
  });

  it("classifies drift so the renderer can explain it", () => {
    expect(parseDesktopUpdateState({ ...available, automaticChecks: undefined })).toEqual({ ok: false, issue: "metadata" });
    expect(parseDesktopUpdateState({ ...available, artifactName: "https://example.invalid/x.exe" }))
      .toEqual({ ok: false, issue: "artifact" });
    expect(parseDesktopUpdateState({ ...available, phase: "downloading", transferred: 1_001, percent: 50 }))
      .toEqual({ ok: false, issue: "progress" });
    expect(parseDesktopUpdateState({ ...available, phase: "downloading", transferred: 1, percent: 101 }))
      .toEqual({ ok: false, issue: "progress" });
    expect(parseDesktopUpdateState({ ...available, phase: "verifying" })).toEqual({ ok: false, issue: "phase" });
  });

  it("rejects fields outside the contract instead of silently dropping them", () => {
    expect(parseDesktopUpdateState({ ...available, downloadUrl: "https://example.invalid" }).ok).toBe(false);
  });
});
