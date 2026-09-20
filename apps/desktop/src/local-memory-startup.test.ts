import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMemoryStartupTrace, writeLocalMemoryStartupReceipt } from "./local-memory-startup.mjs";

describe("private memory startup numeric diagnostics", () => {
  it("records failure stages without serializing errors, values or mutable snapshots", async () => {
    const trace = new LocalMemoryStartupTrace();
    await trace.measure("configuration", async () => ({ apiKey: "secret" }));
    await expect(trace.measure("runtime-admission", async () => { throw new Error("secret-path"); })).rejects.toThrow();
    const receipt = trace.finish("failed");
    expect(receipt).toMatchObject({ outcome: "failed", stages: [
      { stage: "configuration", outcome: "completed" }, { stage: "runtime-admission", outcome: "failed" }
    ] });
    expect(JSON.stringify(receipt)).not.toMatch(/secret|apiKey/u);
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
    receipt.stages.length = 0;
    expect(trace.finish("failed").stages).toHaveLength(2);
  });
  it("atomically retains only the last receipt with owner-only permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "newmoney-startup-timing-"));
    try {
      const trace = new LocalMemoryStartupTrace();
      await writeLocalMemoryStartupReceipt(root, trace.finish("failed"));
      await trace.measure("configuration", async () => undefined);
      const last = trace.finish("completed");
      await writeLocalMemoryStartupReceipt(root, last);
      expect(await readdir(root)).toEqual(["startup-diagnostics.json"]);
      const path = join(root, "startup-diagnostics.json");
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(last);
      if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
