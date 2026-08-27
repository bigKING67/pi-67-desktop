import { describe, expect, it, vi } from "vitest";
import { createR2ReleaseProgressReporter } from "./r2-release-progress.mjs";

describe("R2 release progress reporter", () => {
  it("reports real byte progress, rate, ETA, heartbeat, and receipt metrics", () => {
    let timestamp = Date.parse("2026-08-27T00:00:00.000Z");
    let heartbeat;
    const lines = [];
    const reporter = createR2ReleaseProgressReporter({
      write: (line) => lines.push(line),
      now: () => timestamp,
      setIntervalImpl: (callback) => {
        heartbeat = callback;
        return { unref: vi.fn() };
      },
      clearIntervalImpl: vi.fn(),
      heartbeatIntervalMs: 15_000,
      progressIntervalMs: 5_000
    });

    reporter.stage({
      phase: "start",
      name: "public-verification",
      detail: "artifact 1/3",
      manifestState: "not published"
    });
    reporter.transfer({
      phase: "start",
      operation: "public-readback",
      name: "candidate.exe",
      totalBytes: 64 * 1024 * 1024
    });
    timestamp += 10_000;
    reporter.transfer({
      phase: "progress",
      operation: "public-readback",
      name: "candidate.exe",
      transferredBytes: 32 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024
    });
    timestamp += 15_000;
    heartbeat();
    reporter.transfer({
      phase: "complete",
      operation: "public-readback",
      name: "candidate.exe",
      transferredBytes: 64 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024
    });
    reporter.stage({ phase: "complete", name: "public-verification" });
    const summary = reporter.finish();

    expect(lines.join("")).toContain("manifest not published");
    expect(lines.join("")).toContain("32.0 MiB / 64.0 MiB (50.0%)");
    expect(lines.join("")).toContain("3.2 MiB/s");
    expect(lines.join("")).toContain("ETA 00:10");
    expect(lines.join("")).toContain("public-readback alive candidate.exe");
    expect(summary).toMatchObject({
      elapsedMs: 25_000,
      stages: [{
        name: "public-verification",
        status: "complete",
        elapsedMs: 25_000,
        manifestState: "not published"
      }],
      transfers: [{
        operation: "public-readback",
        name: "candidate.exe",
        status: "complete",
        transferredBytes: 64 * 1024 * 1024,
        totalBytes: 64 * 1024 * 1024,
        elapsedMs: 25_000
      }]
    });
  });

  it("rejects backwards byte observations instead of printing false progress", () => {
    const reporter = createR2ReleaseProgressReporter({
      write: vi.fn(),
      setIntervalImpl: () => ({ unref() {} }),
      clearIntervalImpl: vi.fn()
    });
    reporter.transfer({
      phase: "start",
      operation: "upload",
      name: "candidate.dmg",
      totalBytes: 100,
      transferredBytes: 50
    });

    expect(() => reporter.transfer({
      phase: "progress",
      operation: "upload",
      name: "candidate.dmg",
      totalBytes: 100,
      transferredBytes: 49
    })).toThrow("moved backwards");
    reporter.finish();
  });
});
