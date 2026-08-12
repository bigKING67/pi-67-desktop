import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  capabilityGitTransportCandidates,
  resolveBundledNpmToolchain,
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

  it("resolves npm through the immutable Desktop Node toolchain", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capability-npm-"));
    temporaryRoots.push(root);
    const nodeExecutable = join(root, "node", "node.exe");
    const npmCli = join(root, "npm", "bin", "npm-cli.js");
    await mkdir(join(root, "node"), { recursive: true });
    await mkdir(join(root, "npm", "bin"), { recursive: true });
    await writeFile(nodeExecutable, "node fixture\n", "utf8");
    await writeFile(npmCli, "npm fixture\n", "utf8");
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify({
      paths: {
        node: "node/node.exe",
        npmCli: "npm/bin/npm-cli.js"
      }
    })}\n`, "utf8");

    await expect(resolveBundledNpmToolchain(manifestPath)).resolves.toEqual({
      executable: nodeExecutable,
      argumentsPrefix: [npmCli]
    });

    await writeFile(manifestPath, `${JSON.stringify({
      paths: {
        node: "../outside-node",
        npmCli: "npm/bin/npm-cli.js"
      }
    })}\n`, "utf8");
    await expect(resolveBundledNpmToolchain(manifestPath)).rejects.toThrow(/escaped/u);
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
