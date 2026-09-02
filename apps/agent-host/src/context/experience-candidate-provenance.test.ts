import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import { captureSessionCommitProvenance } from "./experience-candidate-provenance.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("captureSessionCommitProvenance", () => {
  it("hashes the exact stable Pi JSONL bytes without persisting its path or content", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-session-provenance-"));
    roots.push(root);
    const path = join(root, "session.jsonl");
    const content = `${JSON.stringify({ type: "session", id: "session-1", cwd: root })}\n`;
    await writeFile(path, content, "utf8");
    const session = summary(path, root, "session-1", "file-1");

    const provenance = await captureSessionCommitProvenance(
      registry([page([session])]),
      "workspace-1",
      "session-1"
    );

    expect(provenance).toEqual({
      workspaceId: "workspace-1",
      workspaceFingerprint: sha256("pi67-workspace:workspace-1"),
      sourceSessionIdHash: sha256("session-1"),
      sessionContentHash: sha256(content),
      sessionFileIdentityHash: sha256("file-1"),
      sessionBytes: Buffer.byteLength(content),
      capturedAt: expect.any(Number)
    });
  });

  it("fails closed when the Session identity is missing or ambiguous", async () => {
    await expect(captureSessionCommitProvenance(
      registry([page([]), page([])]),
      "workspace-1",
      "missing"
    )).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });

    const root = await mkdtemp(join(tmpdir(), "pi67-session-provenance-"));
    roots.push(root);
    const first = join(root, "first.jsonl");
    const second = join(root, "second.jsonl");
    await Promise.all([writeFile(first, "{}\n"), writeFile(second, "{}\n")]);
    await expect(captureSessionCommitProvenance(
      registry([page([
        summary(first, root, "session-1", "file-1"),
        summary(second, root, "session-1", "file-2")
      ])]),
      "workspace-1",
      "session-1"
    )).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
  });
});

function registry(pages: SessionCatalogPage[]): WorkspaceContextRegistry {
  let index = 0;
  return {
    queryCatalog: async () => pages[Math.min(index++, pages.length - 1)] ?? page([])
  } as unknown as WorkspaceContextRegistry;
}

function page(items: SessionSummary[]): SessionCatalogPage {
  return {
    items,
    total: items.length,
    hasMore: false,
    revision: 1,
    itemCount: items.length,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  };
}

function summary(
  path: string,
  cwd: string,
  id: string,
  fileIdentity: string
): SessionSummary {
  return {
    fileIdentity,
    id,
    path,
    cwd,
    name: id,
    nameSource: "fallback",
    modifiedAt: Date.now(),
    messageCount: 1
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
