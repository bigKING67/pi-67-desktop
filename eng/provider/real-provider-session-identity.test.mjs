import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readIsolatedSessionIdentity } from "./real-provider-session-identity.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })));
});

describe("real Provider Session identity", () => {
  it("selects the newest JSONL and reads only a bounded header before hashing", async () => {
    const root = await createTemporaryAgentDirectory();
    const sessions = join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    const oldPath = join(sessions, "old.jsonl");
    const selectedPath = join(sessions, "selected.jsonl");
    await writeFile(oldPath, '{"type":"session","id":"old"}\n', "utf8");
    const selectedContent = `{"type":"session","id":"selected"}\n${"x".repeat(256 * 1024)}\n`;
    await writeFile(selectedPath, selectedContent, "utf8");
    await utimes(oldPath, new Date(1_000), new Date(1_000));
    await utimes(selectedPath, new Date(2_000), new Date(2_000));

    await expect(readIsolatedSessionIdentity(root)).resolves.toEqual({
      id: "selected",
      relativePath: "sessions/selected.jsonl",
      byteLength: Buffer.byteLength(selectedContent),
      sha256: createHash("sha256").update(selectedContent).digest("hex")
    });
  });

  it("rejects oversized headers and unbounded directory discovery", async () => {
    const oversizedRoot = await createTemporaryAgentDirectory();
    await writeFile(
      join(oversizedRoot, "oversized.jsonl"),
      `${JSON.stringify({ type: "session", id: "x".repeat(100) })}\n`,
      "utf8"
    );
    await expect(readIsolatedSessionIdentity(oversizedRoot, {
      headerLimitBytes: 64
    })).rejects.toThrow(/header exceeds/u);

    const crowdedRoot = await createTemporaryAgentDirectory();
    await Promise.all([
      writeFile(join(crowdedRoot, "one.jsonl"), '{"type":"session","id":"one"}\n'),
      writeFile(join(crowdedRoot, "two.jsonl"), '{"type":"session","id":"two"}\n')
    ]);
    await expect(readIsolatedSessionIdentity(crowdedRoot, {
      discoveryLimit: 1
    })).rejects.toThrow(/discovery exceeded/u);
  });
});

async function createTemporaryAgentDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-provider-session-"));
  temporaryDirectories.push(path);
  return path;
}
