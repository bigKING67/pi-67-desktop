import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareSessionCatalogDirectory,
  removeSessionCatalogRecovery,
  removeSessionCatalogRecoverySync,
  sessionCatalogFileExists
} from "./session-catalog-storage.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Session Catalog storage boundary", () => {
  it("creates only a contained leaf below a real Main-owned root", async () => {
    const root = await canonicalTemporaryRoot();
    const projections = join(root, "projections");
    const catalog = join(projections, "session-catalog");
    await mkdir(projections);

    await expect(prepareSessionCatalogDirectory(catalog, root)).resolves.toBe(catalog);
  });

  it.runIf(process.platform !== "win32")(
    "tightens an existing catalog directory to owner-only permissions",
    async () => {
      const root = await canonicalTemporaryRoot();
      const catalog = join(root, "session-catalog");
      await mkdir(catalog, { mode: 0o755 });
      await chmod(catalog, 0o755);

      await expect(prepareSessionCatalogDirectory(catalog, root)).resolves.toBe(catalog);
      expect((await stat(catalog)).mode & 0o777).toBe(0o700);
    }
  );

  it.runIf(process.platform !== "win32")(
    "fails closed when directory permissions cannot be tightened",
    async () => {
      const root = await canonicalTemporaryRoot();
      const catalog = join(root, "session-catalog");
      await mkdir(catalog, { mode: 0o755 });

      await expect(prepareSessionCatalogDirectory(catalog, root, {
        chmod: async () => {
          throw Object.assign(new Error("not permitted"), { code: "EPERM" });
        },
        stat,
        effectiveUserId: currentUserId
      })).rejects.toMatchObject({ code: "EPERM" });
    }
  );

  it.runIf(process.platform !== "win32")(
    "fails closed when the verified directory mode is still too broad",
    async () => {
      const root = await canonicalTemporaryRoot();
      const catalog = join(root, "session-catalog");
      await mkdir(catalog, { mode: 0o755 });
      const owner = currentUserId();

      await expect(prepareSessionCatalogDirectory(catalog, root, {
        chmod: async () => undefined,
        stat: async () => ({ mode: 0o40755, uid: owner }),
        effectiveUserId: () => owner
      })).rejects.toThrow("permissions are not private");
    }
  );

  it.runIf(process.platform !== "win32")(
    "fails closed when the catalog directory is not owned by the current user",
    async () => {
      const root = await canonicalTemporaryRoot();
      const catalog = join(root, "session-catalog");
      await mkdir(catalog, { mode: 0o700 });
      const owner = currentUserId();

      await expect(prepareSessionCatalogDirectory(catalog, root, {
        chmod: async () => undefined,
        stat: async () => ({ mode: 0o40700, uid: owner + 1 }),
        effectiveUserId: () => owner
      })).rejects.toThrow("not owned by the current user");
    }
  );

  it("rejects lexical escape before creating the requested directory", async () => {
    const root = await canonicalTemporaryRoot();
    const storageRoot = join(root, "user-data");
    const outside = join(root, "outside-catalog");
    await mkdir(storageRoot);

    await expect(prepareSessionCatalogDirectory(outside, storageRoot))
      .rejects.toThrow("escaped its Main-owned storage root");
    await expect(sessionCatalogFileExists(outside)).resolves.toBe(false);
  });

  it("rejects a symlink or junction in the Main-owned directory chain", async () => {
    const root = await canonicalTemporaryRoot();
    const storageRoot = join(root, "user-data");
    const outside = join(root, "outside");
    await Promise.all([mkdir(storageRoot), mkdir(outside)]);
    await symlink(outside, join(storageRoot, "projections"), process.platform === "win32" ? "junction" : "dir");

    await expect(prepareSessionCatalogDirectory(
      join(storageRoot, "projections", "session-catalog"),
      storageRoot
    )).rejects.toThrow("link-based indirection");
  });

  it("rejects directory and symlink storage files without touching their targets", async () => {
    const root = await canonicalTemporaryRoot();
    const directory = join(root, "directory.sqlite3");
    const target = join(root, "target.sqlite3");
    const linked = join(root, "linked.sqlite3");
    await mkdir(directory);
    await writeFile(target, "SENTINEL", "utf8");
    await symlink(target, linked, "file");

    await expect(sessionCatalogFileExists(directory)).rejects.toThrow("private regular file");
    await expect(removeSessionCatalogRecovery(linked)).rejects.toThrow("private regular file");
    expect(() => removeSessionCatalogRecoverySync(linked)).toThrow("private regular file");
    await expect(readFile(target, "utf8")).resolves.toBe("SENTINEL");
  });

  it.runIf(process.platform !== "win32")(
    "rejects hard-linked database and recovery files as external aliases",
    async () => {
      const root = await canonicalTemporaryRoot();
      const outside = join(root, "outside.sqlite3");
      const database = join(root, "database.sqlite3");
      const recovery = join(root, "recovery.sqlite3");
      await writeFile(outside, "SENTINEL", "utf8");
      await Promise.all([link(outside, database), link(outside, recovery)]);

      await expect(sessionCatalogFileExists(database)).rejects.toThrow("private regular file");
      await expect(removeSessionCatalogRecovery(recovery)).rejects.toThrow("private regular file");
      expect(() => removeSessionCatalogRecoverySync(recovery)).toThrow("private regular file");
      await expect(readFile(outside, "utf8")).resolves.toBe("SENTINEL");
    }
  );
});

async function canonicalTemporaryRoot(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "pi67-session-catalog-storage-"));
  temporaryRoots.push(created);
  return realpath(created);
}

function currentUserId(): number {
  if (typeof process.geteuid !== "function") throw new Error("POSIX user identity is unavailable.");
  return process.geteuid();
}
