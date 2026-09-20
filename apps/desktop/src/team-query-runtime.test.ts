import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstalledLocalMemory } from "./installed-local-memory.js";
import { loadOpenVikingRuntimeInstallation } from "./openviking-runtime-installation.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";
import { prepareTeamQueryRuntime } from "./team-query-runtime.js";

const roots: string[] = [], keys = generateKeyPairSync("ed25519");
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-query-admission-")); roots.push(root);
  const memoryRoot = join(root, "memory"), installationRoot = join(memoryRoot, "runtime/private");
  const teamInstallationRoot = join(memoryRoot, "runtime/index"), queryInstallationRoot = join(memoryRoot, "runtime/query");
  const runtimeRoot = join(queryInstallationRoot, "runtime"), bootstrap = join(runtimeRoot, "newmoney-team/query/v1/team_query_worker.py");
  for (const path of [installationRoot, teamInstallationRoot, join(runtimeRoot, "bin"), join(runtimeRoot, "newmoney-team/query/v1")]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  await writeFile(join(installationRoot, "sentinel"), "private");
  await writeFile(join(teamInstallationRoot, "sentinel"), "index");
  await writeFile(join(runtimeRoot, "bin/python3.12"), "synthetic-not-executable", { mode: 0o700 });
  await writeFile(bootstrap, "synthetic-query", { mode: 0o600 });
  const resign = async () => {
    const tree = await runtimeTreeIdentity(runtimeRoot);
    const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: process.platform,
      arch: process.arch, pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
    await writeFile(join(queryInstallationRoot, "manifest.json"), manifest);
    await writeFile(join(queryInstallationRoot, "manifest.sig"), sign(null, manifest, keys.privateKey));
  };
  await resign();
  const options = { memoryRoot, installationRoot, teamInstallationRoot, queryInstallationRoot, trustedKey: keys.publicKey,
    encryption: { isAvailable: vi.fn(() => true), encrypt: vi.fn((value: string) => Buffer.from(value)), decrypt: vi.fn((value: Buffer) => value.toString()) },
    models: { resolve: vi.fn(async () => { throw new Error("Must not resolve models"); }) } };
  const installed = createInstalledLocalMemory(options), lifetime = new AbortController();
  const loadRuntime = (signal: AbortSignal) => loadOpenVikingRuntimeInstallation(queryInstallationRoot, signal);
  return { root, options, installed, runtimeRoot, bootstrap, resign, lifetime, loadRuntime };
}

describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64" || Number.parseInt(release(), 10) < 23)("managed team query runtime", () => {
  it("admits and re-admits the exact query tree without touching profiles, settings, models or index staging", async () => {
    const f = await fixture(), before = await runtimeTreeIdentity(f.options.memoryRoot);
    const runtime = await f.installed.teamQuery.prepareRuntime(f.lifetime.signal);
    expect(runtime.python).toBe(await realpath(join(f.runtimeRoot, "bin/python3.12")));
    expect(runtime.bootstrap).toBe(await realpath(f.bootstrap));
    await runtime.assertLaunchable(new AbortController().signal);
    expect(await runtimeTreeIdentity(f.options.memoryRoot)).toEqual(before);
    expect(await readdir(f.options.memoryRoot)).toEqual(["runtime"]);
    expect(f.options.models.resolve).not.toHaveBeenCalled();
    expect(f.options.encryption.isAvailable).not.toHaveBeenCalled();
    expect(f.options.encryption.decrypt).not.toHaveBeenCalled();
  });
  it.each(["missing", "signature", "tree", "bootstrap", "writable"])("refuses invalid query %s without fallback or storage repair", async mode => {
    const f = await fixture();
    if (mode === "missing") await rm(f.options.queryInstallationRoot, { recursive: true });
    if (mode === "signature") await writeFile(join(f.options.queryInstallationRoot, "manifest.sig"), Buffer.alloc(64));
    if (mode === "tree") await writeFile(f.bootstrap, "changed");
    if (mode === "bootstrap") { await rm(f.bootstrap); await f.resign(); }
    if (mode === "writable") await chmod(f.bootstrap, 0o666);
    await expect(f.installed.teamQuery.prepareRuntime(f.lifetime.signal)).rejects.toThrow();
    expect(await readFile(join(f.options.installationRoot, "sentinel"), "utf8")).toBe("private");
    expect(await readFile(join(f.options.teamInstallationRoot, "sentinel"), "utf8")).toBe("index");
    expect(await readdir(f.options.memoryRoot)).toEqual(["runtime"]);
    expect(f.options.models.resolve).not.toHaveBeenCalled();
  });
  it("never inherits a private/index root when query configuration is omitted", async () => {
    const f = await fixture(), { queryInstallationRoot: _query, ...options } = f.options;
    await expect(createInstalledLocalMemory(options).teamQuery.prepareRuntime(f.lifetime.signal)).rejects.toThrow(/not configured/u);
  });
  it.each(["relative", "private", "index", "nested", "data"])("rejects unsafe query root %s at construction", async kind => {
    const f = await fixture();
    const queryInstallationRoot = { relative: "relative", private: f.options.installationRoot, index: f.options.teamInstallationRoot,
      nested: join(f.options.teamInstallationRoot, "nested"), data: join(f.options.memoryRoot, "data/query") }[kind]!;
    expect(() => createInstalledLocalMemory({ ...f.options, queryInstallationRoot })).toThrow(/absolute|separate/u);
  });
  it("rejects an alternate ancestor path to the private runtime", async () => {
    const f = await fixture(), alias = join(f.root, "alias");
    await symlink(join(f.options.memoryRoot, "runtime"), alias);
    const installed = createInstalledLocalMemory({ ...f.options, installationRoot: join(alias, "query") });
    await expect(installed.teamQuery.prepareRuntime(f.lifetime.signal)).rejects.toThrow(/separate/u);
  });
  it.each([false, true])("rejects runtime changes at launch even when newly signed: %s", async signed => {
    const f = await fixture(), runtime = await f.installed.teamQuery.prepareRuntime(f.lifetime.signal);
    await writeFile(f.bootstrap, "new-synthetic-query");
    if (signed) await f.resign();
    await expect(runtime.assertLaunchable(new AbortController().signal)).rejects.toThrow(signed ? /changed after preparation/u : /identity/u);
  });
  it.each(["prepare", "lifetime", "launch"])("honors %s cancellation", async phase => {
    const f = await fixture();
    if (phase === "prepare") {
      f.lifetime.abort();
      await expect(f.installed.teamQuery.prepareRuntime(f.lifetime.signal)).rejects.toThrow();
      return;
    }
    const runtime = await f.installed.teamQuery.prepareRuntime(f.lifetime.signal), launch = new AbortController();
    if (phase === "lifetime") f.lifetime.abort(); else launch.abort();
    await expect(runtime.assertLaunchable(launch.signal)).rejects.toThrow();
  });
  it("checks cancellation after an asynchronous runtime load, without admitting late results", async () => {
    const f = await fixture(), original = await f.loadRuntime(f.lifetime.signal);
    await expect(prepareTeamQueryRuntime({ trustedKey: keys.publicKey, async loadRuntime() {
      f.lifetime.abort(); return original;
    } }, f.lifetime.signal)).rejects.toThrow();
  });
  it.each(["prepare", "launch"])("gives %s admission its own bounded deadline and rejects an expired signal", async phase => {
    const f = await fixture(), deadline = new AbortController();
    const runtime = phase === "launch" ? await f.installed.teamQuery.prepareRuntime(f.lifetime.signal) : undefined;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      expect(ms).toBe(30_000); return deadline.signal;
    });
    deadline.abort();
    if (runtime) await expect(runtime.assertLaunchable(new AbortController().signal)).rejects.toThrow();
    else await expect(f.installed.teamQuery.prepareRuntime(f.lifetime.signal)).rejects.toThrow();
    expect(timeout).toHaveBeenCalledOnce();
  });
});
