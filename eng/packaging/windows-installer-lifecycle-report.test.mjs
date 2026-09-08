import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recordPhase, recordProgress, writeReport } from "./windows-installer-lifecycle-report.mjs";

describe("Windows lifecycle report checkpoints", () => {
  it("retains completed work while a later launch is running, without claiming success", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-lifecycle-report-"));
    const destination = join(root, "summary.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = { status: "running", phases: [] };
      await recordPhase(report, { name: "install", durationMs: 123 }, destination);
      await recordProgress(report, "clean-profile:launch-0:completed", { closeDurationMs: 200 }, destination);
      await recordProgress(report, "clean-profile:launch-1:shutdown", undefined, destination);
      expect(JSON.parse(await readFile(destination, "utf8"))).toMatchObject({
        status: "running", phases: [{ name: "install", durationMs: 123 }],
        progress: { stage: "clean-profile:launch-1:shutdown" },
        completedLaunches: [{ stage: "clean-profile:launch-0:completed", result: { closeDurationMs: 200 } }]
      });
      expect(log.mock.calls).toEqual([
        ["Windows installer lifecycle: install:completed"],
        ["Windows installer lifecycle: clean-profile:launch-0:completed"],
        ["Windows installer lifecycle: clean-profile:launch-1:shutdown"]
      ]);
      expect(await readdir(root)).toEqual(["summary.json"]);
    } finally { log.mockRestore(); await rm(root, { recursive: true, force: true }); }
  });

  it("preserves the previous report if serialization fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-lifecycle-report-"));
    const destination = join(root, "summary.json");
    try {
      await writeFile(destination, '{"status":"running"}\n');
      const circular = {}; circular.self = circular;
      await expect(writeReport(circular, destination)).rejects.toThrow();
      expect(await readFile(destination, "utf8")).toBe('{"status":"running"}\n');
      expect(await readdir(root)).toEqual(["summary.json"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
