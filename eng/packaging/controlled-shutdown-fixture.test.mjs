import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSingleShutdownQuitLifecycle,
  isProcessAlive,
  readPositiveProcessId,
  resetControlledShutdownLifecycle,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";

describe("controlled shutdown fixture", () => {
  const roots = [];
  const children = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid && isProcessAlive(child.pid)) child.kill();
    }
    await Promise.all(roots.splice(0).map((root) => rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50
    })));
  });

  it("writes the reusable Extension and observes a controlled child lifecycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-shutdown-"));
    roots.push(root);
    const extensionPath = join(root, "shutdown-fixture.ts");
    const childPidPath = join(root, "child.pid");
    const lifecyclePath = join(root, "lifecycle.txt");

    await writeControlledShutdownExtension({ extensionPath, childPidPath, lifecyclePath });
    const source = await readFile(extensionPath, "utf8");
    expect(source).toContain('pi.registerCommand("hold-open"');
    expect(source).toContain('pi.registerProvider("pi67-controlled"');
    expect(source).toContain('pi.on("session_shutdown"');
    expect(source).toContain('options?.signal?.addEventListener("abort"');
    expect(source).toContain("ELECTRON_RUN_AS_NODE");

    const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
    children.push(child);
    if (!child.pid) throw new Error("Controlled test child did not expose a PID.");
    await writeFile(childPidPath, String(child.pid), "utf8");

    await expect(readPositiveProcessId(childPidPath)).resolves.toBe(child.pid);
    expect(isProcessAlive(child.pid)).toBe(true);
    child.kill();
    await expect(waitForProcessExit(child.pid)).resolves.toBeUndefined();
    expect(isProcessAlive(child.pid)).toBe(false);
  });

  it("resets probe evidence and accepts only one final shutdown marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-controlled-shutdown-lifecycle-"));
    roots.push(root);
    const lifecyclePath = join(root, "lifecycle.txt");

    await writeFile(lifecyclePath, "shutdown:quit\n", "utf8");
    await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "fixture")).resolves.toBeUndefined();

    await writeFile(lifecyclePath, "shutdown:quit\nshutdown:quit\n", "utf8");
    await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "fixture"))
      .rejects.toThrow(
        'expected exactly one session_shutdown(reason=quit) lifecycle entry; observed 2: ["shutdown:quit","shutdown:quit"]'
      );

    await writeFile(lifecyclePath, "shutdown:switch\n", "utf8");
    await expect(assertSingleShutdownQuitLifecycle(lifecyclePath, "fixture"))
      .rejects.toThrow(
        'expected exactly one session_shutdown(reason=quit) lifecycle entry; observed 1: ["shutdown:switch"]'
      );

    await resetControlledShutdownLifecycle(lifecyclePath);
    await expect(readFile(lifecyclePath, "utf8")).resolves.toBe("");
  });
});
