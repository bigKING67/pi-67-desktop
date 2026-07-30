import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeNodeSqliteCapability } from "./node-sqlite-capability.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("node:sqlite Agent Host capability", () => {
  it("creates, closes, reopens, verifies and removes a temporary database", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sqlite-capability-test-"));
    temporaryRoots.push(root);

    await expect(probeNodeSqliteCapability(root)).resolves.toMatchObject({
      available: true,
      storage: "temporary-file"
    });
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("reports module loading failure without exposing error contents", async () => {
    const sensitiveDetail = "/Users/example/private/session.jsonl";
    const result = await probeNodeSqliteCapability(undefined, async () => {
      throw new Error(sensitiveDetail);
    });

    expect(result).toEqual({
      available: false,
      detail: "node:sqlite is unavailable in the Pi runtime service.",
      storage: "memory"
    });
    expect(JSON.stringify(result)).not.toContain(sensitiveDetail);
  });
});
