import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { LocalMemoryActivationStore } from "./local-memory-activation-store.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-activation-")); roots.push(root);
  return { root, path: join(root, "activation.json"), store: new LocalMemoryActivationStore(root) };
}
it("defaults to disabled without creating files and atomically persists only explicit consent", async () => {
  const { root, path, store } = await fixture();
  expect(await store.load()).toBe(false); expect(await readdir(root)).toEqual([]);
  await store.save(true); expect(await new LocalMemoryActivationStore(root).load()).toBe(true);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, enabled: true });
  expect((await lstat(path)).mode & 0o777).toBe(0o600);
  await store.save(false); expect(await store.load()).toBe(false);
  expect(await readdir(root)).toEqual(["activation.json"]);
});
it.each(["{}", '{"version":2,"enabled":true}', '{"version":1,"enabled":"true"}', '{"version":1,"enabled":true,"path":"foreign"}', "x".repeat(257)])("rejects malformed or oversized activation %s", async (value) => {
  const { path, store } = await fixture(); await writeFile(path, value, { mode: 0o600 });
  await expect(store.load()).rejects.toThrow(); expect(await readFile(path, "utf8")).toBe(value);
});
it("rejects linked or writable storage without touching the foreign target", async () => {
  const { root, path, store } = await fixture();
  const target = join(root, "foreign.json"); await writeFile(target, "preserve", { mode: 0o600 });
  await symlink(target, path);
  await expect(store.load()).rejects.toThrow(); await expect(store.save(false)).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe("preserve");
  const alias = join(root, "alias"); await symlink(root, alias);
  await expect(new LocalMemoryActivationStore(alias).load()).rejects.toThrow();
  await chmod(root, 0o777); await expect(store.load()).rejects.toThrow(); await chmod(root, 0o700);
});
