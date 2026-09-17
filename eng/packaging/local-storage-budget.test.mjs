import { execFile } from "node:child_process";
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { checkRepositoryStorage, evaluateStorageBudget, measureRepositoryStorage,
  withLocalArtifactStorageBudget, withRepositoryStorageBudget } from "./local-storage-budget.mjs";

const roots = [];
const policy = { schema: "pi67.local-storage-policy.v2", warningBytes: 8_000_000, strongWarningBytes: 10_000_000,
  reserveBytes: { nativePreparation: 1_500_000, nativeSigning: 1_000_000, desktopPackaging: 2_500_000 } };

async function fixture(overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storage-budget-"))); roots.push(root);
  await mkdir(join(root, "eng/packaging"), { recursive: true });
  await writeFile(join(root, "eng/packaging/local-storage-policy.json"), JSON.stringify({ ...policy, ...overrides }));
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("includes nested, hidden and ignored bytes, deduplicates hardlinks and never follows external symlinks", async () => {
  const root = await fixture();
  const outside = await fixture();
  await mkdir(join(root, "artifacts/nested"), { recursive: true });
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "artifacts/nested/payload"), Buffer.alloc(1_000_000));
  await writeFile(join(root, ".git/hidden"), Buffer.alloc(100_000));
  await writeFile(join(outside, "external"), Buffer.alloc(3_000_000));
  const before = await measureRepositoryStorage(root);
  await link(join(root, "artifacts/nested/payload"), join(root, "artifacts/duplicate"));
  await symlink(outside, join(root, "external-link"), "dir");
  const after = await measureRepositoryStorage(root);
  expect(after.bytes).toBeGreaterThanOrEqual(1_100_000);
  expect(after.bytes - before.bytes).toBeLessThan(32_768);
  expect(after.buckets.find(entry => entry.path === "artifacts").bytes).toBeLessThan(1_050_000);
  expect(after.buckets.find(entry => entry.path === ".git").bytes).toBeGreaterThanOrEqual(100_000);
  expect(after.buckets.find(entry => entry.path === "external-link").bytes).toBeLessThan(32_768);
});

it("applies warning boundaries to current and projected totals without a blocked state", () => {
  expect(evaluateStorageBudget({ bytes: 7_999_999 }, policy).status).toBe("PASS");
  expect(evaluateStorageBudget({ bytes: 8_000_000 }, policy).status).toBe("WARNING");
  expect(evaluateStorageBudget({ bytes: 7_499_999 }, policy, "desktopPackaging").status).toBe("WARNING");
  expect(evaluateStorageBudget({ bytes: 7_500_000 }, policy, "desktopPackaging").status).toBe("HIGH_WARNING");
  expect(evaluateStorageBudget({ bytes: 10_000_001 }, policy).status).toBe("HIGH_WARNING");
  expect(() => evaluateStorageBudget({ bytes: 0 }, policy, "unknown")).toThrow("Unknown storage operation");
});

it("keeps standalone checks read-only and rejects missing, malformed and symlinked policy", async () => {
  const root = await fixture();
  expect((await checkRepositoryStorage({ sourceRoot: root })).status).toBe("PASS");
  expect(await readdir(root)).toEqual(["eng"]);
  const path = join(root, "eng/packaging/local-storage-policy.json");
  await writeFile(path, JSON.stringify({ ...policy, strongWarningBytes: 0 }));
  const build = vi.fn();
  await expect(withRepositoryStorageBudget({ sourceRoot: root, operation: "desktopPackaging" }, build)).rejects.toThrow("Invalid local storage policy");
  await rm(path);
  await expect(checkRepositoryStorage({ sourceRoot: root })).rejects.toMatchObject({ code: "ENOENT" });
  const outside = await fixture();
  await symlink(join(outside, "eng/packaging/local-storage-policy.json"), path);
  await expect(checkRepositoryStorage({ sourceRoot: root })).rejects.toThrow("Unsafe local storage policy");
  expect(build).not.toHaveBeenCalled();
});

it("allows new payloads above the strong warning and leaves existing files intact", async () => {
  const root = await fixture({ warningBytes: 1, strongWarningBytes: 2 });
  await writeFile(join(root, "preserved"), "existing");
  const report = vi.fn();
  const build = vi.fn(async () => {
    await writeFile(join(root, "artifacts/new-payload"), "new");
    return "built";
  });
  expect(await withRepositoryStorageBudget({ sourceRoot: root, operation: "nativePreparation", report }, build)).toBe("built");
  expect(build).toHaveBeenCalledOnce();
  expect(report.mock.calls.every(([message]) => message.includes("Storage HIGH_WARNING"))).toBe(true);
  expect(await readdir(join(root, "artifacts"))).toEqual(["new-payload"]);
  expect(await readFile(join(root, "preserved"), "utf8")).toBe("existing");
});

it("warns, permits an in-budget build and returns its original result", async () => {
  const root = await fixture({ warningBytes: 1 });
  const report = vi.fn();
  const result = await withRepositoryStorageBudget({ sourceRoot: root, operation: "nativeSigning", report }, async () => {
    expect(JSON.parse(await readFile(join(root, "artifacts/.storage-budget.lock"), "utf8"))).toMatchObject({ pid: process.pid, operation: "nativeSigning" });
    return "built";
  });
  expect(result).toBe("built");
  expect(report.mock.calls.every(([message]) => message.includes("Storage WARNING"))).toBe(true);
});

it("reports underestimated growth without turning a successful build into failure", async () => {
  const root = await fixture();
  const report = vi.fn();
  const result = await withRepositoryStorageBudget({ sourceRoot: root, operation: "nativeSigning", report }, async () => {
    await writeFile(join(root, "artifacts/large-output"), Buffer.alloc(10_000_001));
    return "complete";
  });
  expect(result).toBe("complete");
  expect(report.mock.calls[0][0]).toContain("Storage PASS");
  expect(report.mock.calls[1][0]).toContain("Storage HIGH_WARNING");
  expect(await readdir(join(root, "artifacts"))).toEqual(["large-output"]);
});

it("preserves the original build failure even when partial output exceeds the strong warning", async () => {
  const root = await fixture();
  const original = new Error("compiler failure");
  const options = { sourceRoot: root, operation: "nativeSigning", report: () => {} };
  await expect(withRepositoryStorageBudget(options, async () => { throw original; })).rejects.toBe(original);
  const failure = await withRepositoryStorageBudget(options, async () => {
    await writeFile(join(root, "partial"), Buffer.alloc(10_000_001));
    throw original;
  }).catch(error => error);
  expect(failure).toBe(original);
  expect(await readdir(join(root, "artifacts"))).toEqual([]);
});

it.each([undefined, null, false, 0])("does not treat a falsy thrown value %s as build success", async thrown => {
  const root = await fixture();
  const result = await withRepositoryStorageBudget({ sourceRoot: root, operation: "nativeSigning", report: () => {} }, async () => { throw thrown; })
    .then(() => ({ ok: true }), error => ({ ok: false, error }));
  expect(result).toEqual({ ok: false, error: thrown });
  expect(await readdir(join(root, "artifacts"))).toEqual([]);
});

it("returns a successful CLI exit code for high warnings so scripted builds can continue", async () => {
  const root = await fixture({ warningBytes: 1, strongWarningBytes: 2 });
  const script = join(root, "eng/packaging/local-storage-budget.mjs");
  await copyFile(new URL("./local-storage-budget.mjs", import.meta.url), script);
  const { stdout } = await promisify(execFile)(process.execPath, [script, "--", "--json", "--for", "desktopPackaging"]);
  expect(JSON.parse(stdout)).toMatchObject({ status: "HIGH_WARNING", operation: "desktopPackaging" });
  expect(await readdir(root)).toEqual(["eng"]);
});

it("serializes different producers and never steals an existing lock", async () => {
  const root = await fixture();
  let enter; let release;
  const entered = new Promise(resolve => { enter = resolve; });
  const running = withRepositoryStorageBudget({ sourceRoot: root, operation: "nativePreparation", report: () => {} }, async () => {
    enter(); await new Promise(resolve => { release = resolve; });
  });
  await entered;
  const build = vi.fn();
  await expect(withRepositoryStorageBudget({ sourceRoot: root, operation: "desktopPackaging" }, build)).rejects.toThrow("locked");
  release(); await running;
  const path = join(root, "artifacts/.storage-budget.lock");
  await writeFile(path, "stale lock needs inspection");
  await expect(withRepositoryStorageBudget({ sourceRoot: root, operation: "nativeSigning" }, build)).rejects.toThrow("locked");
  expect(await readFile(path, "utf8")).toBe("stale lock needs inspection");
  expect(build).not.toHaveBeenCalled();
});

it("rejects a symlinked artifacts directory without writing to its target", async () => {
  const root = await fixture();
  const outside = await fixture();
  await symlink(outside, join(root, "artifacts"), "dir");
  const build = vi.fn();
  await expect(withRepositoryStorageBudget({ sourceRoot: root, operation: "nativeSigning" }, build)).rejects.toThrow("must not be a symlink");
  expect(await readdir(outside)).toEqual(["eng"]);
  expect(build).not.toHaveBeenCalled();
});

it("does not apply the checkout budget to explicitly external native output", async () => {
  const root = await fixture();
  const build = vi.fn(async () => "external");
  expect(await withLocalArtifactStorageBudget(root, "nativeSigning", build)).toBe("external");
  expect(await readdir(root)).toEqual(["eng"]);
});
