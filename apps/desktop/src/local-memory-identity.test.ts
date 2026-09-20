import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalMemoryIdentity, readExistingLocalMemoryIdentity } from "./local-memory-identity.mjs";

const fixtures: string[] = [];
async function fixture() { const root = await mkdtemp(join(tmpdir(), "new-money-profile-")); fixtures.push(root); return root; }
afterEach(async () => { for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("login-independent local memory identity", () => {
  it("reads an established profile without creating or repairing private state", async () => {
    const root = await fixture();
    await expect(readExistingLocalMemoryIdentity(root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(root)).toEqual([]);
    const id = await loadLocalMemoryIdentity(root);
    const profile = join(root, "profile.json"), before = await lstat(profile);
    expect(await readExistingLocalMemoryIdentity(root)).toBe(id);
    expect((await lstat(profile)).ctimeMs).toBe(before.ctimeMs);
    if (process.platform !== "win32") {
      await chmod(profile, 0o644);
      await expect(readExistingLocalMemoryIdentity(root)).rejects.toThrow(/Unsafe/u);
      expect((await lstat(profile)).mode & 0o777).toBe(0o644);
    }
  });
  it("atomically converges concurrent first loads and survives subsequent opens", async () => {
    const root = await fixture();
    const ids = await Promise.all(Array.from({ length: 8 }, () => loadLocalMemoryIdentity(root)));
    expect(new Set(ids).size).toBe(1);
    expect(await loadLocalMemoryIdentity(root)).toBe(ids[0]);
    const record = JSON.parse(await readFile(join(root, "profile.json"), "utf8")) as object;
    expect(Object.keys(record).sort()).toEqual(["localProfileId", "version"]);
  });

  it("does not replace a damaged identity or invent one for orphaned data", async () => {
    const root = await fixture();
    await writeFile(join(root, "profile.json"), "broken");
    await expect(loadLocalMemoryIdentity(root)).rejects.toThrow();
    expect(await readFile(join(root, "profile.json"), "utf8")).toBe("broken");
    const orphan = await fixture();
    await mkdir(join(orphan, "data"));
    await writeFile(join(orphan, "data", "existing-memory"), "synthetic");
    await expect(loadLocalMemoryIdentity(orphan)).rejects.toThrow(/recovery/u);
  });

  it.skipIf(process.platform === "win32")("rejects identity and data symlinks", async () => {
    const root = await fixture();
    const target = await fixture();
    await loadLocalMemoryIdentity(target);
    await symlink(join(target, "profile.json"), join(root, "profile.json"));
    await expect(loadLocalMemoryIdentity(root)).rejects.toThrow(/Invalid/u);
    const orphan = await fixture();
    await symlink(target, join(orphan, "data"));
    await expect(loadLocalMemoryIdentity(orphan)).rejects.toThrow(/recovery/u);
  });
});
