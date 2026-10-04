import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenVikingRuntimeRetirement } from "./openviking-runtime-retirement.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "runtime-retire-"))); roots.push(root);
  const parent = join(root, "runtime"); await mkdir(parent, { mode: 0o700 });
  const keys = generateKeyPairSync("ed25519");
  async function install(version: string, suffix = "") {
    const path = join(parent, `openviking-${version}-python-3.12.10-sdk-0.1.10-darwin-arm64${suffix}`);
    await mkdir(join(path, "runtime/bin"), { recursive: true, mode: 0o700 });
    await writeFile(join(path, "runtime/bin/python3.12"), `synthetic-${version}`);
    const tree = await runtimeTreeIdentity(join(path, "runtime"));
    const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: "darwin", arch: "arm64",
      pythonVersion: "3.12.10", sdkVersion: "0.1.10", openvikingVersion: version, treeSha256: tree.sha256 }));
    await writeFile(join(path, "manifest.json"), manifest); await writeFile(join(path, "manifest.sig"), sign(null, manifest, keys.privateKey));
    return { path, tree: tree.sha256 };
  }
  const old = await install("0.4.16"), current = await install("0.4.22");
  const inUse = vi.fn(async () => false), report = vi.fn();
  const options = { trustedKey: keys.publicKey, inUse, report };
  const controller = new OpenVikingRuntimeRetirement(parent, options);
  return { root, parent, old, current, install, options, controller, inUse, report };
}
const exists = async (path: string) => lstat(path).then(() => true, () => false);
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("verified runtime retirement", () => {
  it("does nothing on construction/admission; isolates purpose and preserves data and newer versions", async () => {
    const f = await fixture(), team = await f.install("0.4.16", "-team-index-v1"), future = await f.install("0.4.23");
    await mkdir(join(f.root, "data")); await writeFile(join(f.root, "data/memory"), "preserve");
    await f.controller.settled(); expect(await exists(join(f.old.path, "runtime"))).toBe(true);
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(false);
    expect(await exists(join(team.path, "runtime"))).toBe(true);
    expect(await exists(join(future.path, "runtime"))).toBe(true);
    expect(await readFile(join(f.root, "data/memory"), "utf8")).toBe("preserve");
    expect(await exists(join(f.old.path, "manifest.sig"))).toBe(true);
    expect(f.report).toHaveBeenLastCalledWith("private", "completed");
  });
  it("rejects stale successful identity without deleting the old runtime", async () => {
    const f = await fixture(); f.controller.verified("private", "f".repeat(64)); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(true); expect(f.report).toHaveBeenCalledWith("private", "deferred");
  });
  it("defers busy runtimes and retries on the next successful use", async () => {
    const f = await fixture(); f.inUse.mockResolvedValueOnce(true);
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(true);
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(false);
  });
  it("resumes interrupted payload removal after restart and renewed verified use", async () => {
    const f = await fixture();
    const first = new OpenVikingRuntimeRetirement(f.parent, { ...f.options, async removePayload(path) {
      await rm(join(path, "bin/python3.12")); throw new Error("interrupted");
    } });
    first.verified("private", f.current.tree); await first.settled(); await first.stop();
    expect(await exists(join(f.old.path, "retirement.json"))).toBe(true);
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(false);
  });
  it.each(["signature", "tree", "unknown", "symlink"])("preserves unsafe old installation: %s", async kind => {
    const f = await fixture();
    if (kind === "signature") await writeFile(join(f.old.path, "manifest.sig"), Buffer.alloc(64));
    if (kind === "tree") await writeFile(join(f.old.path, "runtime/bin/python3.12"), "changed");
    if (kind === "unknown") await writeFile(join(f.old.path, "user-file"), "preserve");
    if (kind === "symlink") { await rename(f.old.path, join(f.root, "outside")); await symlink(join(f.root, "outside"), f.old.path); }
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(true);
  });
  it("rejects directory replacement during occupancy check", async () => {
    const f = await fixture(); f.inUse.mockImplementationOnce(async () => {
      await rename(f.old.path, join(f.root, "saved")); await mkdir(f.old.path); return false;
    });
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.root, "saved/runtime"))).toBe(true); expect(f.report).toHaveBeenCalledWith("private", "deferred");
  });
  it.each(["team-index-v1", "team-query-v1"] as const)("retires only verified %s", async purpose => {
    const f = await fixture(), old = await f.install("0.4.16", `-${purpose}`), current = await f.install("0.4.22", `-${purpose}`);
    f.controller.verified(purpose, current.tree); await f.controller.settled();
    expect(await exists(join(old.path, "runtime"))).toBe(false);
    expect(await exists(join(f.old.path, "runtime"))).toBe(true);
  });
  it("rechecks the replacement after occupancy inspection", async () => {
    const f = await fixture(); f.inUse.mockImplementationOnce(async () => {
      await writeFile(join(f.current.path, "runtime/bin/python3.12"), "changed"); return false;
    });
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(true);
  });
  it("coalesces concurrent successes while an occupancy probe is pending", async () => {
    const f = await fixture(); let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    f.inUse.mockImplementationOnce(async () => { await held; return true; });
    f.controller.verified("private", f.current.tree);
    await vi.waitFor(() => expect(f.inUse).toHaveBeenCalledOnce());
    for (let i = 0; i < 50; i++) f.controller.verified("private", f.current.tree);
    release(); await f.controller.settled(); expect(f.inUse).toHaveBeenCalledOnce();
  });
  it("uses real lsof to preserve an occupied fixture and retires it after exit", async () => {
    const f = await fixture();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: join(f.old.path, "runtime"), stdio: "ignore" });
    await once(child, "spawn");
    const controller = new OpenVikingRuntimeRetirement(f.parent, { trustedKey: f.options.trustedKey, report: f.report });
    try {
      controller.verified("private", f.current.tree); await controller.settled();
      expect(await exists(join(f.old.path, "runtime"))).toBe(true);
    } finally { const exited = once(child, "exit"); child.kill(); await exited; }
    controller.verified("private", f.current.tree); await controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(false);
    await controller.stop();
  });
  it("refuses unknown occupancy and stops queued work on shutdown", async () => {
    const f = await fixture(); f.inUse.mockRejectedValueOnce(new Error("lsof unavailable"));
    f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(true);
    await f.controller.stop(); f.controller.verified("private", f.current.tree); await f.controller.settled();
    expect(await exists(join(f.old.path, "runtime"))).toBe(true);
  });
});
