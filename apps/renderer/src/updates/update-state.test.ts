import { describe, expect, it } from "vitest";
import { parseUpdateState } from "./update-state.js";

describe("update state projection", () => {
  it("accepts canonical available and download progress states", () => {
    const available = {
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      artifactName: "Pi-67-Desktop-0.1.0-alpha.2-mac-arm64-unsigned-preview.zip",
      artifactBytes: 1_000,
      automaticChecks: true,
      checkedAt: "2026-08-20T08:00:00Z"
    };
    expect(parseUpdateState(available)).toEqual({
      ...available,
      checkedAt: "2026-08-20T08:00:00.000Z"
    });
    expect(parseUpdateState({
      ...available,
      phase: "downloading",
      transferred: 500,
      percent: 50
    })).toMatchObject({
      phase: "downloading",
      transferred: 500,
      percent: 50
    });
  });

  it("rejects remote-controlled names, malformed sizes, and impossible progress", () => {
    const base = {
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      artifactName: "https://example.invalid/update.zip",
      artifactBytes: 1_000,
      automaticChecks: true
    };
    expect(parseUpdateState(base)).toMatchObject({ phase: "error" });
    expect(parseUpdateState({ ...base, artifactName: "Pi-67-Desktop-0.1.0-alpha.2-mac-arm64-unsigned-preview.zip", artifactBytes: -1 }))
      .toMatchObject({ phase: "error" });
    expect(parseUpdateState({
      ...base,
      phase: "downloading",
      artifactName: "Pi-67-Desktop-0.1.0-alpha.2-mac-arm64-unsigned-preview.zip",
      transferred: 1_001,
      percent: 101
    })).toMatchObject({ phase: "error" });
  });

  it("requires automatic-check metadata on every state", () => {
    expect(parseUpdateState({
      phase: "current",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1"
    })).toMatchObject({
      phase: "error",
      automaticChecks: false
    });
  });
});
