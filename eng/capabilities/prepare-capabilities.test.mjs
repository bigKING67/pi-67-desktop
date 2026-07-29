import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("Desktop first-party capability source lock", () => {
  it("pins four first-party repositories and the recommended external package set", async () => {
    const lock = JSON.parse(await readFile(resolve(root, "eng/capabilities/capability-sources.lock.json"), "utf8"));
    expect(lock.schema).toBe("pi67.capability-sources-lock.v1");
    expect(lock.sources.map((source) => source.id)).toEqual([
      "pi67-core",
      "browser67",
      "design-craft",
      "commerce-growth-os"
    ]);
    expect(lock.sources.every((source) => /^[0-9a-f]{40}$/u.test(source.commit))).toBe(true);
    expect(lock.recommendedExternal.map((entry) => entry.id)).toEqual([
      "pi-subagents",
      "pi-observational-memory",
      "pi-fff",
      "pi-web-access",
      "pi-smart-fetch",
      "pi-plan-mode",
      "pi-rewind",
      "pi-mcp-adapter"
    ]);
  });
});
