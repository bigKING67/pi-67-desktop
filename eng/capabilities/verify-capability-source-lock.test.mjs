import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { verifyCapabilitySourceLock } from "./verify-capability-source-lock.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("capability source lock reachability", () => {
  it("verifies every first-party source and Skill Pack commit", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const verifyCommit = vi.fn().mockResolvedValue(undefined);

    const result = await verifyCapabilitySourceLock({ lock, verifyCommit });

    expect(result.schema).toBe("pi67.capability-source-reachability.v1");
    expect(result.sources.map((source) => source.id)).toEqual([
      "browser67",
      "design-craft",
      "commerce-growth-os",
      "skill-pack:ai-berkshire-investment-suite"
    ]);
    expect(verifyCommit).toHaveBeenCalledTimes(4);
  });

  it("reports the exact locked source that a clean runner cannot fetch", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    const verifyCommit = vi.fn(async (source) => {
      if (source.id === "browser67") throw new Error("upload-pack: not our ref");
    });

    await expect(verifyCapabilitySourceLock({ lock, verifyCommit })).rejects.toThrow(
      /Locked capability source browser67 is not remotely fetchable.*upload-pack: not our ref/u
    );
  });
});
