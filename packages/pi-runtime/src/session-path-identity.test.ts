import { link, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeSessionCatalogPathIdentity,
  normalizeSessionCatalogWorkspaceIdentity,
  normalizeWindowsFilesystemPathSpelling,
  resolveExistingSessionFileIdentity,
  versionSessionCatalogSourceIdentity
} from "./session-path-identity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("session path identity", () => {
  it("preserves exact canonical spelling for physical paths and versions source identity", () => {
    const path = join("CaseSensitive", "Session.JSONL");

    expect(normalizeSessionCatalogPathIdentity(path)).toBe(resolve(path));
    expect(normalizeSessionCatalogPathIdentity(path)).not.toBe(
      normalizeSessionCatalogPathIdentity(join("casesensitive", "session.jsonl"))
    );
    expect(versionSessionCatalogSourceIdentity("source")).toBe("session-catalog-source-v3\0source");
  });

  it("matches Workspace cwd keys using Windows case-insensitive path semantics", () => {
    const upper = String.raw`C:\CaseSensitive\Workspace 中文`;
    const lower = String.raw`c:\casesensitive\workspace 中文`;

    expect(normalizeSessionCatalogWorkspaceIdentity(upper, "win32")).toBe(
      normalizeSessionCatalogWorkspaceIdentity(lower, "win32")
    );
    expect(normalizeSessionCatalogWorkspaceIdentity(upper, "darwin")).not.toBe(
      normalizeSessionCatalogWorkspaceIdentity(lower, "darwin")
    );
  });

  it("matches Windows extended drive, UNC, slash, and Unicode spellings", () => {
    expect(normalizeSessionCatalogWorkspaceIdentity(
      String.raw`\\?\C:\Workspace\项目`,
      "win32"
    )).toBe(normalizeSessionCatalogWorkspaceIdentity(String.raw`c:/workspace/项目`, "win32"));
    expect(normalizeSessionCatalogWorkspaceIdentity(
      String.raw`\\?\UNC\Server\Share\项目`,
      "win32"
    )).toBe(normalizeSessionCatalogWorkspaceIdentity(String.raw`\\server\share\项目`, "win32"));
    expect(normalizeSessionCatalogWorkspaceIdentity(String.raw`C:\Café`, "win32")).toBe(
      normalizeSessionCatalogWorkspaceIdentity(String.raw`c:\café`, "win32")
    );
    expect(normalizeWindowsFilesystemPathSpelling(String.raw`\\?\C:\Workspace\项目`))
      .toBe(String.raw`c:\workspace\项目`);
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
