import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  capabilityGitTransportCandidates,
  runCapabilityGitCommand
} from "./capability-source-resolver.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50
  })));
});

describe("Desktop capability source resolver", () => {
  it("uses the canonical GitHub transport before bounded mirrors", () => {
    const canonical = "https://github.com/bigKING67/pi-67.git";
    expect(capabilityGitTransportCandidates(canonical)).toEqual([
      canonical,
      "https://gitclone.com/github.com/bigKING67/pi-67.git",
      `https://ghproxy.net/${canonical}`
    ]);
  });

  it("terminates a timed-out Git process tree before returning control", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capability-source-"));
    temporaryRoots.push(root);
    const heartbeatPath = join(root, "heartbeat.txt");
    const workerPath = join(root, "worker.mjs");
    const parentPath = join(root, "parent.mjs");
    await writeFile(workerPath, [
      'import { appendFileSync } from "node:fs";',
      'const heartbeatPath = process.argv[2];',
      'appendFileSync(heartbeatPath, "x");',
      'setInterval(() => appendFileSync(heartbeatPath, "x"), 20);'
    ].join("\n"), "utf8");
    await writeFile(parentPath, [
      'import { spawn } from "node:child_process";',
      'const [workerPath, heartbeatPath] = process.argv.slice(2);',
      'spawn(process.execPath, [workerPath, heartbeatPath], { stdio: "ignore" });',
      'setInterval(() => {}, 1_000);'
    ].join("\n"), "utf8");

    await expect(runCapabilityGitCommand(
      { executable: process.execPath, execPath: root },
      [parentPath, workerPath, heartbeatPath],
      { timeoutMs: 1_000 }
    )).rejects.toThrow(/timed out/u);

    await delay(100);
    const firstSize = (await stat(heartbeatPath)).size;
    await delay(150);
    expect((await stat(heartbeatPath)).size).toBe(firstSize);
    expect(await readFile(heartbeatPath, "utf8")).not.toBe("");
  });
});
