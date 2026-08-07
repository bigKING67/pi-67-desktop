import { link, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeSessionCatalogPathIdentity,
  resolveExistingSessionFileIdentity,
  versionSessionCatalogSourceIdentity
} from "./session-path-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("session path identity", () => {
  it("preserves exact canonical spelling instead of lowercasing Windows paths", () => {
    const path = join("CaseSensitive", "Session.JSONL");

    expect(normalizeSessionCatalogPathIdentity(path)).toBe(resolve(path));
    expect(normalizeSessionCatalogPathIdentity(path)).not.toBe(
      normalizeSessionCatalogPathIdentity(join("casesensitive", "session.jsonl"))
    );
    expect(versionSessionCatalogSourceIdentity("source")).toBe("session-catalog-source-v3\0source");
  });

  it("deduplicates hard-linked JSONL aliases by physical file identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-session-path-identity-"));
    roots.push(root);
    const original = join(root, "original.jsonl");
    const alias = join(root, "alias.jsonl");
    await writeFile(original, "{}\n");
    await link(original, alias);

    await expect(resolveExistingSessionFileIdentity(alias)).resolves.toBe(
      await resolveExistingSessionFileIdentity(original)
    );
  });
});
