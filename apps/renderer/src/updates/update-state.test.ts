import { describe, expect, it } from "vitest";
import { parseUpdateState } from "./update-state.js";

describe("update state projection", () => {
  it("accepts a canonical available release with automatic-check metadata", () => {
    expect(parseUpdateState({
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
      automaticChecks: true,
      checkedAt: "2026-08-03T08:00:00Z"
    })).toEqual({
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
      automaticChecks: true,
      checkedAt: "2026-08-03T08:00:00.000Z"
    });
  });

  it("rejects remote-controlled release URLs and malformed metadata", () => {
    expect(parseUpdateState({
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      releaseUrl: "https://example.invalid/download",
      automaticChecks: true
    })).toMatchObject({
      phase: "error",
      currentVersion: "0.1.0-alpha.1",
      automaticChecks: true
    });
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
