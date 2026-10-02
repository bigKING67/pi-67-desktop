import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityTreeSha256, copyCapabilityDirectory } from "./desktop-capability-file-integrity.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.mocked(writeFile).mockReset();
  vi.mocked(writeFile).mockImplementation((await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).writeFile);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-capability-copy-"));
  roots.push(root);
  const source = join(root, "source");
  const destination = join(root, "destination");
  await mkdir(source);
  return { root, source, destination };
}

describe("capability directory copy", () => {
  it("preserves bytes, executable permissions, nested files and module filtering", async () => {
    const { source, destination } = await fixture();
    await mkdir(join(source, "nested"));
    await mkdir(join(source, "node_modules"));
    for (let index = 0; index < 19; index += 1) {
      await writeFile(join(source, `a${index}.bin`), Buffer.alloc(170_000, index));
    }
    await writeFile(join(source, "large.bin"), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
    await writeFile(join(source, "nested", "run.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(join(source, "nested", "run.sh"), 0o755);
    await writeFile(join(source, ".DS_Store"), "ignored");
    await writeFile(join(source, "node_modules", "entry.js"), "export {};");

    await copyCapabilityDirectory(source, destination, source, false);
    expect(await capabilityTreeSha256(destination)).toBe(await capabilityTreeSha256(source));
    await expect(stat(join(destination, ".DS_Store"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(destination, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    if (process.platform !== "win32") {
      expect((await stat(join(destination, "a0.bin"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(destination, "nested", "run.sh"))).mode & 0o777).toBe(0o755);
    }
    const withModules = `${destination}-modules`;
    await copyCapabilityDirectory(source, withModules, source, true);
    expect(await capabilityTreeSha256(withModules, true)).toBe(await capabilityTreeSha256(source, true));
  });

  it("waits for every started write before rejecting and starts no further file", async () => {
    const { source, destination } = await fixture();
    const names = Array.from({ length: 40 }, (_, index) => `f${String(index).padStart(2, "0")}`);
    for (const name of names) await writeFile(join(source, name), "content");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
      if (typeof path !== "string") throw new Error("Expected a capability file path.");
      const name = basename(path);
      started.push(name);
      if (name === "f00") throw new Error("synthetic copy failure");
      // Hold every other write so only the failure frees a slot.
      await held;
      return actual.writeFile(path, data, options);
    });
    let settled = false;
    const outcome = copyCapabilityDirectory(source, destination, source, false)
      .then(() => undefined, (error: unknown) => error)
      .finally(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(started).toHaveLength(32));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    expect(await outcome).toEqual(new Error("synthetic copy failure"));
    expect(started.sort()).toEqual(names.slice(0, 32));
    expect(await readFile(join(destination, "f07"), "utf8")).toBe("content");
  });

  it("copies small directories concurrently instead of one directory at a time", async () => {
    const { source, destination } = await fixture();
    for (const directory of ["a", "b", "c"]) {
      await mkdir(join(source, directory));
      await writeFile(join(source, directory, `${directory}.txt`), directory);
    }
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
      if (typeof path !== "string") throw new Error("Expected a capability file path.");
      started.push(basename(path));
      if (basename(path) === "a.txt") await held;
      return actual.writeFile(path, data, options);
    });
    const copied = copyCapabilityDirectory(source, destination, source, false);
    try {
      await vi.waitFor(() => expect([...started].sort()).toEqual(["a.txt", "b.txt", "c.txt"]));
    } finally {
      release();
      await copied;
    }
    expect(await capabilityTreeSha256(destination)).toBe(await capabilityTreeSha256(source));
  });

  it.each([4_500_000, 8 * 1024 * 1024 + 1])("copies %i-byte files alone within the in-flight byte budget", async (size) => {
    const { source, destination } = await fixture();
    for (let index = 0; index < 3; index += 1) await writeFile(join(source, `f${index}`), Buffer.alloc(size, index));
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started: string[] = [];
    vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
      if (typeof path !== "string") throw new Error("Expected a capability file path.");
      const name = basename(path);
      started.push(name);
      if (name === "f0") await held;
      return actual.writeFile(path, data, options);
    });
    const copied = copyCapabilityDirectory(source, destination, source, false);
    try {
      await vi.waitFor(() => expect(started).toContain("f0"));
      expect(started).toEqual(["f0"]);
    } finally {
      release();
      await copied;
    }
    expect(started).toEqual(["f0", "f1", "f2"]);
    expect(await capabilityTreeSha256(destination)).toBe(await capabilityTreeSha256(source));
  });

  it("rejects links without copying their targets", async () => {
    const { root, source, destination } = await fixture();
    const external = join(root, "external");
    await mkdir(external);
    await writeFile(join(external, "private.txt"), "outside");
    await symlink(external, join(source, "link"), "junction");
    await expect(copyCapabilityDirectory(source, destination, source, false)).rejects.toThrow("cannot contain symlinks");
    await expect(stat(join(destination, "link"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
