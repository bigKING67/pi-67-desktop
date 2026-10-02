import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPackagedSmokeGuard } from "./packaged-smoke-failure-evidence.mjs";

const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function guardFixture(window) {
  const directory = await mkdtemp(join(tmpdir(), "pi67-smoke-evidence-"));
  directories.push(directory);
  const guard = createPackagedSmokeGuard({
    application: () => ({ windows: () => window ? [window] : [] }),
    processOutput: () => `synthetic output ${"x".repeat(9_000)}`,
    deadlineMs: 60_000, directory
  });
  return { guard, directory };
}

describe("packaged smoke failure evidence", () => {
  it("fails a hung stage at its own bound with the stage name", async () => {
    const { guard } = await guardFixture();
    await expect(guard.stage("workbench-journey", () => new Promise(() => {}), 20))
      .rejects.toThrow(/stage "workbench-journey" exceeded 20 ms/u);
    await expect(guard.stage("ok", async () => 7)).resolves.toBe(7);
    guard.stop();
  });

  it("records the stage, bounded output, surface and screenshot once", async () => {
    const screenshot = vi.fn(async () => undefined);
    const window = { evaluate: vi.fn(async () => ({ title: "synthetic" })), screenshot };
    const { guard, directory } = await guardFixture(window);
    await guard.stage("changes-inspector", () => Promise.reject(new Error("locator missing"))).catch((error) => guard.fail(error));
    await guard.fail(new Error("second failure is ignored"));
    guard.stop();
    const failure = JSON.parse(await readFile(join(directory, "failure.json"), "utf8"));
    expect(failure).toMatchObject({ stage: "changes-inspector" });
    expect(failure.error).toContain("locator missing");
    expect((await readFile(join(directory, "process-output.txt"), "utf8")).length).toBe(8_192);
    expect(screenshot).toHaveBeenCalledOnce();
    expect(screenshot.mock.calls[0][0].path).toBe(join(directory, "changes-inspector.png"));
    expect((await readdir(directory)).sort()).toEqual(["failure.json", "process-output.txt"]);
  });
});
