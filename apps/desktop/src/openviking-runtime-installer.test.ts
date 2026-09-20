import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOpenVikingRuntime, OPENVIKING_INSTALLATION_NAME, OPENVIKING_QUERY_INSTALLATION_NAME, OPENVIKING_TEAM_INSTALLATION_NAME } from "./openviking-runtime-installer.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

const copying = vi.hoisted(() => ({ after: undefined as ((destination: string) => Promise<void>) | undefined,
  stat: undefined as ((path: string) => void) | undefined }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, lstat: async (...args: Parameters<typeof fs.lstat>) => {
    try { return await fs.lstat(...args); } finally { copying.stat?.(String(args[0])); }
  }, cp: async (...args: Parameters<typeof fs.cp>) => {
    await fs.cp(...args); await copying.after?.(String(args[1]));
  } };
});
const roots: string[] = [];
afterEach(async () => {
  copying.after = undefined;
  copying.stat = undefined;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(team: boolean | "query" = false) {
  const root = await mkdtemp(join(tmpdir(), "new-money-installer-")); roots.push(root);
  const source = join(root, "source"); const parent = join(root, "安装目录");
  await mkdir(join(source, "runtime/bin"), { recursive: true }); await mkdir(parent);
  await writeFile(join(source, "runtime/bin/python3.12"), "synthetic-not-executable", { mode: 0o700 });
  if (team) {
    const scripts = join(source, team === "query" ? "runtime/newmoney-team/query/v1" : "runtime/newmoney-team/v1"); await mkdir(scripts, { recursive: true, mode: 0o700 });
    for (const name of team === "query" ? ["team_query_worker.py"] : ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"]) {
      await writeFile(join(scripts, name), "synthetic-not-executable", { mode: 0o600 });
    }
  }
  const tree = await runtimeTreeIdentity(join(source, "runtime"));
  const keys = generateKeyPairSync("ed25519");
  const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: "darwin",
    arch: "arm64", pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
  await writeFile(join(source, "manifest.json"), manifest);
  await writeFile(join(source, "manifest.sig"), sign(null, manifest, keys.privateKey));
  const abort = new AbortController();
  const options = { source, parent, signal: abort.signal, trustedKey: keys.publicKey };
  return { root, source, parent, tree, keys, abort, options, target: join(parent, OPENVIKING_INSTALLATION_NAME) };
}

describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("local runtime installation transaction", () => {
  it("imports query v1 independently without replacing or activating either existing runtime", async () => {
    const index = await fixture(true), query = await fixture("query");
    await installOpenVikingRuntime(index.options);
    await installOpenVikingRuntime({ ...index.options, purpose: "team-index-v1" });
    const lock = join(index.parent, `.${OPENVIKING_TEAM_INSTALLATION_NAME}.install-lock`);
    await writeFile(lock, "synthetic-lock");
    const options = { ...query.options, parent: index.parent, purpose: "team-query-v1" as const };
    const result = await installOpenVikingRuntime(options);
    expect(result).toEqual({ installationRoot: await realpath(join(index.parent, OPENVIKING_QUERY_INSTALLATION_NAME)), tree: query.tree, activated: false });
    await expect(installOpenVikingRuntime(options)).rejects.toThrow(/already exists/u);
    expect(await runtimeTreeIdentity(join(index.target, "runtime"))).toEqual(index.tree);
    expect(await runtimeTreeIdentity(join(index.parent, OPENVIKING_TEAM_INSTALLATION_NAME, "runtime"))).toEqual(index.tree);
    expect(await readFile(lock, "utf8")).toBe("synthetic-lock");
  });
  it.each([false, true])("cannot relabel a private/index runtime as query v1: %s", async team => {
    const f = await fixture(team);
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "team-query-v1" })).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
  });
  it.each(["source", "copy", "cancel"])("rejects query %s corruption/cancellation and leaves other versions untouched", async mode => {
    const f = await fixture("query"); await installOpenVikingRuntime(f.options);
    if (mode === "source") await writeFile(join(f.source, "runtime/newmoney-team/query/v1/team_query_worker.py"), "changed");
    else copying.after = async path => {
      if (mode === "cancel") f.abort.abort();
      else await writeFile(join(path, "newmoney-team/query/v1/team_query_worker.py"), "changed");
    };
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "team-query-v1" })).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([OPENVIKING_INSTALLATION_NAME]);
    expect(await runtimeTreeIdentity(join(f.target, "runtime"))).toEqual(f.tree);
  });
  it("installs a verified team revision alongside the unchanged private version without activation", async () => {
    const f = await fixture(true); await installOpenVikingRuntime(f.options);
    const original = await readFile(join(f.target, "manifest.json"));
    const result = await installOpenVikingRuntime({ ...f.options, purpose: "team-index-v1" });
    expect(result).toEqual({ installationRoot: await realpath(join(f.parent, OPENVIKING_TEAM_INSTALLATION_NAME)), tree: f.tree, activated: false });
    expect(await readFile(join(f.target, "manifest.json"))).toEqual(original);
    expect((await readdir(f.parent)).sort()).toEqual([OPENVIKING_INSTALLATION_NAME, OPENVIKING_TEAM_INSTALLATION_NAME].sort());
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "team-index-v1" })).rejects.toThrow(/already exists/u);
    expect(await runtimeTreeIdentity(join(f.target, "runtime"))).toEqual(f.tree);
  });
  it("does not relabel an older signed private bundle as team-capable", async () => {
    const f = await fixture(); await installOpenVikingRuntime(f.options);
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "team-index-v1" })).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([OPENVIKING_INSTALLATION_NAME]);
  });
  it.each(["missing", "empty", "writable", "symlink"])("rejects a signed team bundle with a %s companion", async mode => {
    const f = await fixture(true), path = join(f.source, "runtime/newmoney-team/v1/team_model_channel.py");
    if (mode === "missing" || mode === "symlink") await rm(path);
    if (mode === "symlink") await symlink("team_index_worker.py", path);
    if (mode === "empty") await writeFile(path, "");
    if (mode === "writable") await chmod(path, 0o666);
    const manifestPath = join(f.source, "manifest.json"), previous = JSON.parse(await readFile(manifestPath, "utf8")) as object;
    const manifest = Buffer.from(JSON.stringify({ ...previous, treeSha256: (await runtimeTreeIdentity(join(f.source, "runtime"))).sha256 }));
    await writeFile(manifestPath, manifest); await writeFile(join(f.source, "manifest.sig"), sign(null, manifest, f.keys.privateKey));
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "team-index-v1" })).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
  });
  it.each(["tamper", "cancel"])("retains the private version and discards only new team staging on %s", async mode => {
    const f = await fixture(true); await installOpenVikingRuntime(f.options);
    copying.after = async path => {
      if (mode === "cancel") f.abort.abort();
      else await writeFile(join(path, "newmoney-team/v1/team_model_channel.py"), "tampered");
    };
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "team-index-v1" })).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([OPENVIKING_INSTALLATION_NAME]);
    expect(await runtimeTreeIdentity(join(f.target, "runtime"))).toEqual(f.tree);
  });
  it("keeps version locks independent and refuses unknown target purposes", async () => {
    const f = await fixture(true), lock = `.${OPENVIKING_INSTALLATION_NAME}.install-lock`;
    await writeFile(join(f.parent, lock), "retained-lock");
    await expect(installOpenVikingRuntime({ ...f.options, purpose: "other" as never })).rejects.toThrow(/purpose/u);
    await installOpenVikingRuntime({ ...f.options, purpose: "team-index-v1" });
    expect((await readdir(f.parent)).sort()).toEqual([lock, OPENVIKING_TEAM_INSTALLATION_NAME].sort());
    expect(await readFile(join(f.parent, lock), "utf8")).toBe("retained-lock");
  });
  it("publishes only the verified tree and preserves other versions and private state", async () => {
    const f = await fixture();
    await mkdir(join(f.parent, "previous-version")); await writeFile(join(f.root, "private-memory"), "retained");
    copying.after = async () => { expect(await readdir(f.parent)).not.toContain(OPENVIKING_INSTALLATION_NAME); };
    const result = await installOpenVikingRuntime(f.options);
    expect(result).toEqual({ installationRoot: await realpath(f.target), tree: f.tree, activated: false });
    expect(await runtimeTreeIdentity(join(f.target, "runtime"))).toEqual(f.tree);
    expect((await readdir(f.parent)).sort()).toEqual([OPENVIKING_INSTALLATION_NAME, "previous-version"].sort());
    expect(await readFile(join(f.root, "private-memory"), "utf8")).toBe("retained");
  });
  it("refuses even an empty existing version directory", async () => {
    const f = await fixture(); await mkdir(f.target);
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow(/already exists/u);
    expect(await readdir(f.parent)).toEqual([OPENVIKING_INSTALLATION_NAME]);
  });
  it("does not trust a key shipped by the source or a synthetic signing key by default", async () => {
    const f = await fixture();
    await expect(installOpenVikingRuntime({ source: f.source, parent: f.parent, signal: f.abort.signal })).rejects.toThrow(/signature/u);
    expect(await readdir(f.parent)).toEqual([]);
  });
  it("rejects a changed signed source before staging", async () => {
    const f = await fixture(); await writeFile(join(f.source, "runtime/extra"), "tampered");
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow(/identity/u);
    expect(await readdir(f.parent)).toEqual([]);
  });
  it("re-verifies the copied tree and rolls back only its staging on corruption", async () => {
    const f = await fixture(); copying.after = async (path) => { await writeFile(join(path, "extra"), "tampered"); };
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow(/identity/u);
    expect(await readdir(f.parent)).toEqual([]);
    expect(await runtimeTreeIdentity(join(f.source, "runtime"))).toEqual(f.tree);
  });
  it("does not touch the parent when already cancelled", async () => {
    const f = await fixture(); f.abort.abort();
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
  });
  it("cleans staging and releases its lock when cancelled during copying", async () => {
    const f = await fixture(); copying.after = async () => { f.abort.abort(); };
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
  });
  it("honors cancellation arriving during the final destination check", async () => {
    const f = await fixture();
    copying.after = async () => { copying.stat = (path) => { if (path.endsWith(OPENVIKING_INSTALLATION_NAME)) f.abort.abort(); }; };
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
  });
  it("refuses overlapping source and destination without creating a lock", async () => {
    const f = await fixture();
    await expect(installOpenVikingRuntime({ ...f.options, parent: f.source })).rejects.toThrow(/overlap/u);
    expect((await readdir(f.source)).sort()).toEqual(["manifest.json", "manifest.sig", "runtime"]);
  });
  it("rejects a linked or group-writable installation parent", async () => {
    const f = await fixture(); const link = join(f.root, "linked"); await symlink(f.parent, link);
    await expect(installOpenVikingRuntime({ ...f.options, parent: link })).rejects.toThrow(/owned/u);
    await chmod(f.parent, 0o770);
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow(/owned/u);
    expect(await readdir(f.parent)).toEqual([]);
  });
  it("never steals an existing lock or removes another operation's files", async () => {
    const f = await fixture(); const lockName = `.${OPENVIKING_INSTALLATION_NAME}.install-lock`;
    await writeFile(join(f.parent, lockName), "other operation");
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow();
    expect(await readFile(join(f.parent, lockName), "utf8")).toBe("other operation");
  });
  it("rejects a concurrent installer while the first owns staging", async () => {
    const f = await fixture();
    copying.after = async () => { await expect(installOpenVikingRuntime(f.options)).rejects.toThrow(); };
    await installOpenVikingRuntime(f.options);
    expect(await readdir(f.parent)).toEqual([OPENVIKING_INSTALLATION_NAME]);
  });
  it("preserves a target that appears before publication and removes only its staging", async () => {
    const f = await fixture();
    copying.after = async () => { await mkdir(f.target); await writeFile(join(f.target, "owned"), "retain"); };
    await expect(installOpenVikingRuntime(f.options)).rejects.toThrow(/already exists/u);
    expect(await readdir(f.parent)).toEqual([OPENVIKING_INSTALLATION_NAME]);
    expect(await readFile(join(f.target, "owned"), "utf8")).toBe("retain");
  });
});
