import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstalledLocalMemory } from "./installed-local-memory.js";
import { loadLocalMemoryIdentity } from "./local-memory-identity.mjs";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";
import { bindSharedKnowledgeOwner } from "./shared-knowledge-owner.js";

const roots: string[] = [];
const keys = generateKeyPairSync("ed25519");
const teamId = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const supported = process.platform === "darwin" && process.arch === "arm64" && Number.parseInt(release(), 10) >= 23;
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-team-preparation-")); roots.push(root);
  const memoryRoot = join(root, "memory");
  const localProfileId = await loadLocalMemoryIdentity(memoryRoot);
  const installationRoot = join(memoryRoot, "runtime/v1");
  const runtimeRoot = join(installationRoot, "runtime");
  await mkdir(join(runtimeRoot, "bin"), { recursive: true, mode: 0o700 });
  await writeFile(join(runtimeRoot, "bin/python3.12"), "synthetic-interpreter");
  const tree = await runtimeTreeIdentity(runtimeRoot);
  const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: process.platform,
    arch: process.arch, pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
  await writeFile(join(installationRoot, "manifest.json"), manifest);
  await writeFile(join(installationRoot, "manifest.sig"), sign(null, manifest, keys.privateKey));
  const options = { memoryRoot, installationRoot, trustedKey: keys.publicKey,
    encryption: { isAvailable: vi.fn(() => true), encrypt: vi.fn((text: string) => Buffer.from(text)),
      decrypt: vi.fn((bytes: Buffer) => bytes.toString()) }, models: { resolve: vi.fn() } };
  const owner = { localProfileId, endpoint: "https://fixture.invalid", userId: "user-one", teamId,
    scopeKind: "team" as const, scopeId: teamId };
  return { root, options, owner, runtimeRoot, tree, preparation: createInstalledLocalMemory(options).teamPreparation };
}

describe.skipIf(!supported)("Main team worker runtime and staging preparation", () => {
  it("prepares and revalidates only the explicitly selected team revision without touching private state", async () => {
    const { options, owner, runtimeRoot } = await fixture();
    const teamInstallationRoot = join(options.memoryRoot, "runtime/team-index-v1");
    await cp(options.installationRoot, teamInstallationRoot, { recursive: true });
    const teamRuntime = join(teamInstallationRoot, "runtime"), scripts = join(teamRuntime, "newmoney-team/v1");
    await mkdir(scripts, { recursive: true, mode: 0o700 });
    for (const name of ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"]) {
      await writeFile(join(scripts, name), "synthetic-team-script", { mode: 0o600 });
    }
    const manifestPath = join(teamInstallationRoot, "manifest.json");
    const manifest = Buffer.from(JSON.stringify({ ...JSON.parse(await readFile(manifestPath, "utf8")) as object,
      treeSha256: (await runtimeTreeIdentity(teamRuntime)).sha256 }));
    await writeFile(manifestPath, manifest); await writeFile(join(teamInstallationRoot, "manifest.sig"), sign(null, manifest, keys.privateKey));
    const profile = await readFile(join(options.memoryRoot, "profile.json"));
    const installed = createInstalledLocalMemory({ ...options, teamInstallationRoot });
    const prepared = await installed.teamPreparation.prepareIndexWorker(owner, new AbortController().signal);
    try {
      expect(prepared.runtime.runtimeRoot).toBe(await realpath(teamRuntime));
      // A broken private bundle cannot redirect or poison team admission.
      await writeFile(join(runtimeRoot, "bin/python3.12"), "broken-private-fixture");
      await prepared.assertLaunchable(new AbortController().signal);
      await writeFile(join(scripts, "team_model_channel.py"), "tampered-team");
      await expect(prepared.assertLaunchable(new AbortController().signal)).rejects.toThrow(/identity/u);
      await expect(installed.teamPreparation.prepareIndexWorker(owner, new AbortController().signal)).rejects.toThrow(/identity/u);
      expect(await readFile(join(options.memoryRoot, "profile.json"))).toEqual(profile);
      expect(options.models.resolve).not.toHaveBeenCalled(); expect(options.encryption.decrypt).not.toHaveBeenCalled();
    } finally { await prepared.discard(); }
  });
  it("requires the signed runtime's production bootstrap separately from basic preparation", async () => {
    const { options, owner, preparation, runtimeRoot } = await fixture();
    await expect(preparation.prepareIndexWorker(owner, new AbortController().signal)).rejects.toThrow();
    const staging = join(options.memoryRoot, "team-projections", bindSharedKnowledgeOwner(owner).key, "staging");
    expect(await readdir(staging)).toEqual([]);
    const scripts = join(runtimeRoot, "newmoney-team/v1"); await mkdir(scripts, { recursive: true, mode: 0o700 });
    for (const name of ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"]) {
      await writeFile(join(scripts, name), "synthetic-script", { mode: 0o600 });
    }
    // Unmeasured new files cannot acquire the old runtime signature's trust.
    await expect(preparation.prepareIndexWorker(owner, new AbortController().signal)).rejects.toThrow(/identity/u);
    const manifestPath = join(options.installationRoot, "manifest.json");
    const original = JSON.parse(await readFile(manifestPath, "utf8")) as object;
    const manifest = Buffer.from(JSON.stringify({ ...original, treeSha256: (await runtimeTreeIdentity(runtimeRoot)).sha256 }));
    await writeFile(manifestPath, manifest);
    await writeFile(join(options.installationRoot, "manifest.sig"), sign(null, manifest, keys.privateKey));
    const prepared = await preparation.prepareIndexWorker(owner, new AbortController().signal);
    expect(prepared.bootstrap).toBe(await realpath(join(scripts, "team_index_worker.py")));
    await prepared.assertLaunchable(new AbortController().signal);
    const aborted = new AbortController(); aborted.abort();
    await expect(prepared.assertLaunchable(aborted.signal)).rejects.toThrow();
    await writeFile(join(scripts, "team_index_worker.py"), "changed-script");
    await expect(prepared.assertLaunchable(new AbortController().signal)).rejects.toThrow(/identity/u);
    // Even a correctly signed replacement cannot silently change this task's runtime.
    const replacement = Buffer.from(JSON.stringify({ ...original, treeSha256: (await runtimeTreeIdentity(runtimeRoot)).sha256 }));
    await writeFile(manifestPath, replacement);
    await writeFile(join(options.installationRoot, "manifest.sig"), sign(null, replacement, keys.privateKey));
    await expect(prepared.assertLaunchable(new AbortController().signal)).rejects.toThrow(/changed after preparation/u);
    await prepared.discard();
  });
  it("admits the signed installation into a separate empty run without model settings or private writes", async () => {
    const { options, owner, preparation, runtimeRoot, tree } = await fixture();
    await mkdir(join(options.memoryRoot, "data"), { mode: 0o700 });
    await writeFile(join(options.memoryRoot, "data/private-fixture"), "private sentinel");
    const profile = await lstat(join(options.memoryRoot, "profile.json"));
    const result = await preparation.prepare(owner, new AbortController().signal);
    const root = await realpath(options.memoryRoot);
    expect(result.directory).toMatch(new RegExp(`^${root}/team-projections/${bindSharedKnowledgeOwner(owner).key}/staging/run-`));
    expect(await readdir(result.directory)).toEqual([]);
    expect((await lstat(result.directory)).mode & 0o777).toBe(0o700);
    expect(result.runtime).toEqual({ runtimeRoot: await realpath(runtimeRoot),
      python: await realpath(join(runtimeRoot, "bin/python3.12")), tree });
    expect(result).not.toHaveProperty("bootstrap");
    expect(result).not.toHaveProperty("launch");
    expect(options.models.resolve).not.toHaveBeenCalled();
    expect(options.encryption.decrypt).not.toHaveBeenCalled();
    expect((await lstat(join(root, "profile.json"))).ctimeMs).toBe(profile.ctimeMs);
    expect(await readFile(join(root, "data/private-fixture"), "utf8")).toBe("private sentinel");
    await result.assertCurrent();
    await result.discard(); await result.discard();
    await expect(lstat(result.directory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(result.assertCurrent()).rejects.toThrow(/discarded/u);
    expect(await readFile(join(root, "data/private-fixture"), "utf8")).toBe("private sentinel");
  });

  it("snapshots the owner and isolates concurrent runs plus changed user, service, team and project", async () => {
    const { owner, preparation } = await fixture();
    const mutable = { ...owner };
    const first = preparation.prepare(mutable, new AbortController().signal);
    mutable.userId = "mutated";
    const changes = [{}, { userId: "user-two" }, { endpoint: "https://fixture.invalid/v2" },
      { endpoint: "https://fixture.invalid:8443" }, { teamId: other, scopeId: other },
      { scopeKind: "project" as const, scopeId: other }];
    const prepared = await Promise.all([first, ...changes.map((change) => preparation.prepare({ ...owner, ...change }, new AbortController().signal))]);
    expect(prepared[0]?.owner.userId).toBe("user-one");
    expect(prepared[0]?.scopeKey).toBe(prepared[1]?.scopeKey);
    expect(new Set(prepared.map((result) => result.directory)).size).toBe(7);
    expect(new Set(prepared.map((result) => result.scopeKey)).size).toBe(6);
    await Promise.all(prepared.map((result) => result.discard()));
  });

  it.each(["signature", "runtime", "profile-missing", "profile-mismatch", "profile-mode"])("rejects %s without staging creation or identity repair", async (kind) => {
    const { options, owner, runtimeRoot, preparation } = await fixture();
    const profile = join(options.memoryRoot, "profile.json");
    if (kind === "signature") await writeFile(join(options.installationRoot, "manifest.sig"), Buffer.alloc(64));
    if (kind === "runtime") await writeFile(join(runtimeRoot, "bin/python3.12"), "tampered");
    if (kind === "profile-missing") await rm(profile);
    if (kind === "profile-mismatch") owner.localProfileId = other;
    if (kind === "profile-mode") await chmod(profile, 0o644);
    await expect(preparation.prepare(owner, new AbortController().signal)).rejects.toThrow();
    expect(await readdir(options.memoryRoot)).not.toContain("team-projections");
    if (kind === "profile-missing") await expect(lstat(profile)).rejects.toMatchObject({ code: "ENOENT" });
    if (kind === "profile-mode") expect((await lstat(profile)).mode & 0o777).toBe(0o644);
  });

  it.each(["team-projections", "owner", "staging"])("refuses a symlinked %s directory without writing through it", async (component) => {
    const { root, options, owner, preparation } = await fixture();
    const target = join(root, "foreign"); await mkdir(target, { mode: 0o700 });
    const key = bindSharedKnowledgeOwner(owner).key;
    const components = ["team-projections", key, "staging"];
    const depth = component === "team-projections" ? 0 : component === "owner" ? 1 : 2;
    const parent = join(options.memoryRoot, ...components.slice(0, depth));
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await symlink(target, join(parent, components[depth]!));
    await expect(preparation.prepare(owner, new AbortController().signal)).rejects.toThrow(/Unsafe/u);
    expect(await readdir(target)).toEqual([]);
  });

  it("rejects a shared-readable root without chmod and refuses runtime/projection overlap at construction", async () => {
    const { options, owner, preparation } = await fixture();
    await chmod(options.memoryRoot, 0o755);
    await expect(preparation.prepare(owner, new AbortController().signal)).rejects.toThrow(/Unsafe/u);
    expect((await lstat(options.memoryRoot)).mode & 0o777).toBe(0o755);
    expect(() => createInstalledLocalMemory({ ...options, installationRoot: join(options.memoryRoot, "team-projections/runtime") }))
      .toThrow(/separate/u);
  });

  it("does not cache admission across preparation calls", async () => {
    const { owner, runtimeRoot, preparation } = await fixture();
    const first = await preparation.prepare(owner, new AbortController().signal); await first.discard();
    await writeFile(join(runtimeRoot, "bin/python3.12"), "tampered");
    await expect(preparation.prepare(owner, new AbortController().signal)).rejects.toThrow(/identity/u);
  });

  it("honors the owner lifetime and profile changes while retaining exact cleanup after cancellation", async () => {
    const { options, owner, preparation } = await fixture();
    const controller = new AbortController(); controller.abort();
    await expect(preparation.prepare(owner, controller.signal)).rejects.toThrow();
    expect(await readdir(options.memoryRoot)).not.toContain("team-projections");
    const lifetime = new AbortController();
    const result = await preparation.prepare(owner, lifetime.signal);
    await writeFile(join(options.memoryRoot, "profile.json"), JSON.stringify({ version: 1, localProfileId: other }));
    await expect(result.assertCurrent()).rejects.toThrow(/profile mismatch/u);
    lifetime.abort();
    await expect(result.assertCurrent()).rejects.toThrow();
    await result.discard();
  });

  it.each(["populated", "replaced", "parent-replaced"])("retains %s staging on cleanup failure rather than deleting foreign content", async (kind) => {
    const { root, owner, preparation } = await fixture();
    const result = await preparation.prepare(owner, new AbortController().signal);
    if (kind === "replaced") {
      await rename(result.directory, join(root, "original-run"));
      await mkdir(result.directory, { mode: 0o700 });
    } else if (kind === "parent-replaced") {
      const staging = join(result.directory, "..");
      await rename(staging, join(root, "original-staging"));
      await mkdir(result.directory, { recursive: true, mode: 0o700 });
    }
    const marker = join(result.directory, "retain-fixture"); await writeFile(marker, "retain");
    await expect(result.discard()).rejects.toThrow();
    expect(await readFile(marker, "utf8")).toBe("retain");
  });
});

it.skipIf(supported)("fails closed on an unsupported team runtime target", async () => {
  const { options, owner, preparation } = await fixture();
  await expect(preparation.prepare(owner, new AbortController().signal)).rejects.toThrow(/macOS 14/u);
  expect(await readdir(options.memoryRoot)).not.toContain("team-projections");
});
