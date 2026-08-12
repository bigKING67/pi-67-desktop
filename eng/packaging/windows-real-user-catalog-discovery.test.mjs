import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSessionCatalogContext,
  normalizeSessionCatalogCwd
} from "../../packages/pi-runtime/src/index.ts";
import { resolveExistingSessionFileIdentity } from "../../packages/pi-runtime/src/session-path-identity.ts";
import { inspectRealUserSessionCatalogDiscovery } from "./windows-real-user-catalog-discovery.mjs";

describe("Windows real-user Catalog discovery diagnostics", () => {
  it("uses the production discovery path without exposing private identity or content", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-real-user-discovery-diagnostic-"));
    const agentDir = join(root, "private-agent");
    const workspace = join(root, "private-workspace");
    const sessionDirectory = join(agentDir, "sessions", "workspace");
    const sessionPath = join(sessionDirectory, "private-session.jsonl");
    const now = new Date().toISOString();
    await Promise.all([
      mkdir(sessionDirectory, { recursive: true }),
      mkdir(workspace, { recursive: true })
    ]);
    await writeFile(sessionPath, `${JSON.stringify({
      type: "session",
      version: 3,
      id: "diagnostic-session",
      timestamp: now,
      cwd: workspace
    })}\n${JSON.stringify({
      type: "message",
      id: "diagnostic-message",
      parentId: null,
      timestamp: now,
      message: { role: "user", content: "private prompt", timestamp: Date.now() }
    })}\n`, "utf8");
    const fileIdentity = await resolveExistingSessionFileIdentity(sessionPath);

    try {
      const diagnostic = await inspectRealUserSessionCatalogDiscovery({
        agentDir,
        expectedSessionIdentity: `session:workspace:${fileIdentity}`,
        sessionPath,
        workspace
      }, {
        createSessionCatalogContext,
        normalizeSessionCatalogCwd
      });
      expect(diagnostic).toMatchObject({
        currentPhysicalRecordPresent: true,
        currentRecordWorkspaceMatch: true,
        discoveryState: "complete",
        expectedPathRecordPresent: process.platform !== "darwin",
        expectedPhysicalRecordPresent: true,
        expectedRecordWorkspaceMatch: true,
        incomplete: false,
        recordCount: 1,
        skippedCount: 0,
        workspaceMatchedRecordCount: 1
      });
      expect(diagnostic.currentFileIdentityFingerprint).toMatch(/^[0-9a-f]{12}$/u);
      expect(diagnostic.expectedIdentityFileFingerprint).toBe(diagnostic.currentFileIdentityFingerprint);
      expect(diagnostic.sessionDirectoryDepth).toBe(2);
      const serialized = JSON.stringify(diagnostic);
      expect(serialized).not.toContain(root);
      expect(serialized).not.toContain(fileIdentity);
      expect(serialized).not.toContain("private prompt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
