import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_CATALOG_DATABASE_FILENAME,
  SESSION_CATALOG_RECOVERY_FILENAME,
  openSqliteSessionCatalog
} from "./sqlite-session-catalog.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe("SQLite Session Catalog hard-link safety", () => {
  it.runIf(process.platform !== "win32")(
    "does not rename or remove hard-linked external aliases during corruption recovery",
    async () => {
      const databaseRoot = await temporaryRoot();
      const outsideDatabase = join(databaseRoot, "outside-database.sqlite3");
      await writeFile(outsideDatabase, "DATABASE_SENTINEL", "utf8");
      await link(outsideDatabase, join(databaseRoot, SESSION_CATALOG_DATABASE_FILENAME));

      expect(await openSqliteSessionCatalog(databaseRoot)).toEqual({
        kind: "fallback",
        reason: "unavailable",
        degradedReason: "storage-inspect"
      });
      await expect(readFile(outsideDatabase, "utf8")).resolves.toBe("DATABASE_SENTINEL");

      const recoveryRoot = await temporaryRoot();
      const outsideRecovery = join(recoveryRoot, "outside-recovery.sqlite3");
      await writeFile(join(recoveryRoot, SESSION_CATALOG_DATABASE_FILENAME), "corrupt", "utf8");
      await writeFile(outsideRecovery, "RECOVERY_SENTINEL", "utf8");
      await link(outsideRecovery, join(recoveryRoot, SESSION_CATALOG_RECOVERY_FILENAME));

      expect(await openSqliteSessionCatalog(recoveryRoot)).toEqual({
        kind: "fallback",
        reason: "unavailable",
        degradedReason: "recovery-prepare"
      });
      await expect(readFile(outsideRecovery, "utf8")).resolves.toBe("RECOVERY_SENTINEL");
    }
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-catalog-sqlite-hard-link-"));
  temporaryRoots.push(root);
  return root;
}
