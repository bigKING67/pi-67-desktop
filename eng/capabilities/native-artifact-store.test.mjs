import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectNativeArtifacts, runNativeArtifact } from "./native-artifact-store.mjs";
import { withRepositoryStorageBudget } from "../packaging/local-storage-budget.mjs";

const roots = [];
async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "native-artifact-store-"))); roots.push(parent);
  const build = vi.fn(async path => {
    await mkdir(join(path, "runtime"));
    await writeFile(join(path, "runtime/payload"), "verified-runtime");
    await writeFile(join(path, "receipt.json"), "historical evidence");
    return { path, bytes: 16 };
  });
  const validate = async (path, value) => {
    if (value.path !== path || await readFile(join(path, "runtime/payload"), "utf8") !== "verified-runtime") throw new Error("changed");
  };
  const options = { parent, kind: "preparation", purpose: "private", build, validate, probeInUse: async () => false, report: () => {} };
  const run = (key, extra = {}) => runNativeArtifact({ ...options, key: createHash("sha256").update(String(key)).digest("hex"), ...extra });
  return { parent, run, build };
}
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("native artifact bounded lifecycle", () => {
  it("reuses verified cached bytes and admits changed native inputs above the strong warning", async () => {
    const { parent, run, build } = await fixture();
    const first = await run(1);
    await mkdir(join(parent, "eng/packaging"), { recursive: true });
    await writeFile(join(parent, "eng/packaging/local-storage-policy.json"), JSON.stringify({
      schema: "pi67.local-storage-policy.v2", warningBytes: 1, strongWarningBytes: 2,
      reserveBytes: { nativePreparation: 1, nativeSigning: 1, desktopPackaging: 1 }
    }));
    const withBuildBudget = task => withRepositoryStorageBudget({ sourceRoot: parent, operation: "nativePreparation", report: () => {} }, task);
    expect(await run(1, { withBuildBudget })).toMatchObject({ path: first.path, artifactReuse: "VERIFIED_EXISTING" });
    expect(await run(2, { withBuildBudget })).toMatchObject({ artifactReuse: "CREATED" });
    expect(build).toHaveBeenCalledTimes(2);
    expect(await inspectNativeArtifacts(parent)).toHaveLength(2);
    expect((await readdir(parent)).filter(name => name.startsWith("preparation-"))).toHaveLength(2);
  });

  it("reuses identical input over repeated runs without adding payloads", async () => {
    const { parent, run, build } = await fixture();
    const first = await run(1);
    for (let index = 0; index < 5; index++) expect(await run(1)).toMatchObject({ path: first.path, artifactReuse: "VERIFIED_EXISTING" });
    expect(build).toHaveBeenCalledTimes(1);
    expect(await inspectNativeArtifacts(parent)).toHaveLength(1);
    expect(await readdir(parent)).toHaveLength(1);
  });

  it("bounds changed inputs to two successful payloads while retaining receipts and legacy directories", async () => {
    const { parent, run } = await fixture();
    await mkdir(join(parent, "preparation-legacy/runtime"), { recursive: true });
    await writeFile(join(parent, "preparation-legacy/runtime/keep"), "legacy");
    const first = await run(1);
    for (let key = 2; key <= 6; key++) await run(key);
    expect(await inspectNativeArtifacts(parent)).toHaveLength(2);
    await expect(readFile(join(first.path, "runtime/payload"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(first.path, "receipt.json"), "utf8")).toBe("historical evidence");
    expect(await readFile(join(parent, "preparation-legacy/runtime/keep"), "utf8")).toBe("legacy");
  });

  it("keeps only the latest failure payload without discarding successful outputs", async () => {
    const { parent, run } = await fixture();
    await run(1);
    for (let key = 2; key <= 5; key++) await expect(run(key, { build: async path => {
      await mkdir(join(path, "staging")); await writeFile(join(path, "staging/partial"), "failed");
      throw new Error("synthetic failure");
    } })).rejects.toThrow("synthetic failure");
    const entries = await inspectNativeArtifacts(parent);
    expect(entries.map(entry => entry.status).sort((a, b) => a.localeCompare(b))).toEqual(["FAILED", "READY"]);
    const failedPayloads = [];
    for (const name of await readdir(parent)) {
      const children = await readdir(join(parent, name));
      if (children.includes("staging")) failedPayloads.push(name);
    }
    expect(failedPayloads).toHaveLength(1);
  });

  it("protects pinned and busy capacity before creating a new directory", async () => {
    const { parent, run, build } = await fixture();
    await run(1, { pin: true }); await run(2, { pin: true });
    await expect(run(3)).rejects.toThrow("capacity is protected");
    expect(build).toHaveBeenCalledTimes(2);
    expect(await readdir(parent)).toHaveLength(2);
    const second = await fixture();
    await second.run(1); await second.run(2);
    await expect(second.run(3, { probeInUse: async () => true })).rejects.toThrow("capacity is protected");
    expect(second.build).toHaveBeenCalledTimes(2);
  });

  it("rejects changed cached bytes without claiming reuse or making another copy", async () => {
    const { parent, run, build } = await fixture();
    const first = await run(1);
    await writeFile(join(first.path, "runtime/payload"), "corrupt");
    await expect(run(1)).rejects.toThrow("changed");
    expect(build).toHaveBeenCalledTimes(1);
    expect(await readdir(parent)).toHaveLength(1);
  });

  it("serializes concurrent generators and releases the lock after failure", async () => {
    const { parent, run } = await fixture();
    let release; let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const pending = run(1, { build: async () => { entered(); await new Promise(resolve => { release = resolve; }); throw new Error("failed"); } });
    const failure = pending.catch(error => error);
    await started;
    await expect(run(2)).rejects.toThrow("locked");
    release(); expect((await failure).message).toBe("failed");
    await run(2);
    expect(await readdir(parent)).not.toContain(".native-artifacts.lock");
  });

  it("never follows a replaced payload symlink during retirement", async () => {
    const { run } = await fixture();
    const first = await run(1); await run(2);
    const outside = await mkdtemp(join(tmpdir(), "native-protected-")); roots.push(outside);
    await writeFile(join(outside, "keep"), "protected");
    await rm(join(first.path, "runtime"), { recursive: true });
    await symlink(outside, join(first.path, "runtime"));
    await expect(run(3)).rejects.toThrow("Unsafe native artifact payload");
    expect(await readFile(join(outside, "keep"), "utf8")).toBe("protected");
  });
});
