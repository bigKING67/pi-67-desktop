import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentHostStoragePaths } from "./agent-host-storage.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Agent Host storage", () => {
  it("creates the Session Catalog under the canonical Electron userData root", async () => {
    const root = await temporaryRoot();
    const userData = join(root, "user-data");

    const storage = createAgentHostStoragePaths(userData);

    expect(storage.capabilityProbeDirectory).toContain("user-data");
    expect(storage.sessionCatalogDirectory).toBe(join(storage.capabilityProbeDirectory, "projections", "session-catalog"));
  });

  it.runIf(process.platform === "win32")("hands native-canonical Windows paths to the Agent Host", async () => {
    const root = await temporaryRoot();
    const userData = join(root, "user-data");

    const storage = createAgentHostStoragePaths(userData);

    expect(storage.storageRoot).toBe(realpathSync.native(userData));
    expect(storage.sessionCatalogDirectory).toBe(realpathSync.native(join(userData, "projections", "session-catalog")));
  });

  it.each(["user-data", "projections", "session-catalog"] as const)(
    "rejects a pre-existing symlink or junction at the %s storage level",
    async (level) => {
      const root = await temporaryRoot();
      const userData = join(root, "user-data");
      const outside = join(root, "outside");
      await mkdir(outside);
      if (level === "user-data") {
        await symlink(outside, userData, process.platform === "win32" ? "junction" : "dir");
      } else if (level === "projections") {
        await mkdir(userData);
        await symlink(outside, join(userData, "projections"), process.platform === "win32" ? "junction" : "dir");
      } else {
        await mkdir(join(userData, "projections"), { recursive: true });
        await symlink(
          outside,
          join(userData, "projections", "session-catalog"),
          process.platform === "win32" ? "junction" : "dir"
        );
      }

      expect(() => createAgentHostStoragePaths(userData)).toThrow(/real directory|reparse-point/u);
    }
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-agent-host-storage-"));
  roots.push(root);
  return root;
}
