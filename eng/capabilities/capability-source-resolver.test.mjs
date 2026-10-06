import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  capabilityGitTransportCandidates,
  resolveExactCapabilitySource,
  resolveBundledNpmToolchain,
  runCapabilityGitCommand
} from "./capability-source-resolver.mjs";

const PROCESS_FIXTURE_TIMEOUT_MS = 15_000;
const temporaryRoots = [];
const execFileAsync = promisify(execFile);

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
    const canonical = "https://github.com/bigKING67/browser67.git";
    expect(capabilityGitTransportCandidates(canonical)).toEqual([
      canonical,
      "https://gitclone.com/github.com/bigKING67/browser67.git",
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

  it("resolves a contained Desktop-internal capability without Git or a sibling repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-internal-capability-"));
    temporaryRoots.push(root);
    const internal = join(root, "packages", "internal-capability");
    await mkdir(internal, { recursive: true });
    await writeFile(join(internal, "package.json"), "{}\n", "utf8");

    await expect(resolveExactCapabilitySource({
      source: { id: "internal-capability", internalPath: "packages/internal-capability" },
      repositoryRoot: root,
      sourceCacheRoot: join(root, "cache"),
      git: undefined
    })).resolves.toBe(internal);

    await expect(resolveExactCapabilitySource({
      source: { id: "escaped", internalPath: "../outside" },
      repositoryRoot: root,
      sourceCacheRoot: join(root, "cache"),
      git: undefined
    })).rejects.toThrow(/escaped the Desktop repository/u);
  });

  it("reuses an exact clean source cache with the canonical remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-capability-cache-"));
    temporaryRoots.push(root);
    const sourceCacheRoot = join(root, "cache");
    const destination = join(sourceCacheRoot, "fixture-source");
    const repository = "https://github.com/example/fixture-source.git";
    await mkdir(destination, { recursive: true });
    await execFileAsync("git", ["init", destination]);
    await execFileAsync("git", ["-C", destination, "config", "user.name", "Pi-67 Test"]);
    await execFileAsync("git", ["-C", destination, "config", "user.email", "pi67@example.invalid"]);
    await writeFile(join(destination, "fixture.txt"), "fixture\n", "utf8");
    await execFileAsync("git", ["-C", destination, "add", "fixture.txt"]);
    await execFileAsync("git", ["-C", destination, "commit", "-m", "fixture"]);
    await execFileAsync("git", ["-C", destination, "remote", "add", "origin", repository]);
    const { stdout: commitOutput } = await execFileAsync("git", ["-C", destination, "rev-parse", "HEAD"]);
    const { stdout: execPathOutput } = await execFileAsync("git", ["--exec-path"]);
    const sentinel = join(destination, ".git", "cache-sentinel");
    await writeFile(sentinel, "preserved\n", "utf8");

    await expect(resolveExactCapabilitySource({
      source: {
        id: "fixture-source",
        repository,
        commit: commitOutput.trim(),
        localSibling: "../missing-fixture-source"
      },
      repositoryRoot: root,
      sourceCacheRoot,
      git: { executable: "git", execPath: execPathOutput.trim() }
    })).resolves.toBe(destination);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("preserved\n");
  }, PROCESS_FIXTURE_TIMEOUT_MS);

  it("resolves a pinned monorepo package and isolates dirty sibling changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-monorepo-source-"));
    temporaryRoots.push(root);
    const checkout = join(root, "craft67");
    const desktop = join(root, "desktop");
    const pkg = join(checkout, "packages", "browser67");
    await mkdir(pkg, { recursive: true });
    await mkdir(desktop);
    const gitRun = async (...args) => (await execFileAsync("git", ["-C", checkout, ...args])).stdout.trim();
    await execFileAsync("git", ["init", checkout]);
    await gitRun("config", "user.name", "Pi-67 Test");
    await gitRun("config", "user.email", "pi67@example.invalid");
    await writeFile(join(pkg, "package.json"), '{"name":"browser67"}\n');
    await gitRun("add", "packages/browser67/package.json");
    await gitRun("commit", "-m", "monorepo fixture");
    const source = { id: "browser67", repository: "https://github.com/example/craft67.git",
      localSibling: "../craft67", sourceDirectory: "packages/browser67", commit: await gitRun("rev-parse", "HEAD") };
    const { stdout } = await execFileAsync("git", ["--exec-path"]);
    const options = { source, repositoryRoot: desktop, sourceCacheRoot: join(root, "cache"),
      git: { executable: "git", execPath: stdout.trim() } };
    await expect(resolveExactCapabilitySource(options)).resolves.toBe(pkg);
    await writeFile(join(pkg, "package.json"), '{"name":"user-wip"}\n');
    const cached = await resolveExactCapabilitySource(options);
    expect(cached).toBe(join(root, "cache", "browser67", "packages", "browser67"));
    expect(JSON.parse(await readFile(join(cached, "package.json"), "utf8")).name).toBe("browser67");
    expect(JSON.parse(await readFile(join(pkg, "package.json"), "utf8")).name).toBe("user-wip");
    await expect(resolveExactCapabilitySource(options)).resolves.toBe(cached);
    for (const sourceDirectory of ["../escape", "/tmp/escape", "packages/../../escape", "packages\\escape"]) {
      await expect(resolveExactCapabilitySource({ ...options, source: { ...source, sourceDirectory } }))
        .rejects.toThrow(/Invalid capability source directory/u);
    }
    await writeFile(join(pkg, "package.json"), '{"name":"browser67"}\n');
    await symlink(desktop, join(checkout, "packages", "escaped"), "junction");
    await writeFile(join(checkout, ".git", "info", "exclude"), "packages/escaped\n");
    await expect(resolveExactCapabilitySource({ ...options,
      source: { ...source, sourceDirectory: "packages/escaped", commit: await gitRun("rev-parse", "HEAD") }
    })).rejects.toThrow(/not contained/u);
  }, PROCESS_FIXTURE_TIMEOUT_MS);

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
      { timeoutMs: 5_000 }
    )).rejects.toThrow(/timed out/u);

    await delay(100);
    const firstSize = (await stat(heartbeatPath)).size;
    await delay(150);
    expect((await stat(heartbeatPath)).size).toBe(firstSize);
    expect(await readFile(heartbeatPath, "utf8")).not.toBe("");
  }, PROCESS_FIXTURE_TIMEOUT_MS);
});
