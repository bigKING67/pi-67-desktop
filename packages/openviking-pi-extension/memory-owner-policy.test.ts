import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectMemoryOwnerConflict } from "./memory-owner-policy.js";

describe("OpenViking self owner policy", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("does not treat a retired directory on disk as an active owner", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-owner-policy-"));
    await mkdir(join(root, "extensions", "pi-observational-memory"), { recursive: true });
    await writeFile(join(root, "settings.json"), JSON.stringify({ packages: [
      { source: "pi-observational-memory", extensions: [] },
      "@pi67/openviking-pi-extension",
    ] }));

    expect(detectMemoryOwnerConflict(root)).toBeNull();
  });

  it("fails closed for explicitly configured competing owners", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-owner-policy-"));
    await writeFile(join(root, "settings.json"), JSON.stringify({
      packages: ["pi-hy-memory", "@pi67/openviking-pi-extension"],
    }));

    expect(detectMemoryOwnerConflict(root)).toEqual({
      owner: "pi67-openviking",
      conflicts: ["pi-hy-memory"],
      reason: "multiple-context-owners",
    });
  });

  it("recognizes an explicitly enabled top-level OpenViking competitor", async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-owner-policy-"));
    await writeFile(join(root, "settings.json"), JSON.stringify({
      packages: ["@pi67/openviking-pi-extension"],
      extensions: ["/opt/other-openviking/index.ts"],
    }));

    expect(detectMemoryOwnerConflict(root)?.reason).toBe("duplicate-openviking-owner");
  });
});
