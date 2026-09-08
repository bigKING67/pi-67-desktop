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
  it("binds the accepted Session despite a newer unrelated JSONL", async () => {
    const root = await createTemporaryAgentDirectory();
    const sessions = join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    const oldPath = join(sessions, "old.jsonl");
    const selectedPath = join(sessions, "selected.jsonl");
    await writeFile(oldPath, '{"type":"session","id":"old"}\n', "utf8");
    const selectedContent = `{"type":"session","id":"selected"}\n${"x".repeat(256 * 1024)}\n`;
    await writeFile(selectedPath, selectedContent, "utf8");
    await utimes(oldPath, new Date(3_000), new Date(3_000));
    await utimes(selectedPath, new Date(2_000), new Date(2_000));

    await expect(readIsolatedSessionIdentity(root, { expectedSessionId: "selected" })).resolves.toEqual({
      id: "selected",
      relativePath: "sessions/selected.jsonl",
      byteLength: Buffer.byteLength(selectedContent),
      sha256: createHash("sha256").update(selectedContent).digest("hex")
    });
  });

  it("fails closed for absent or duplicate accepted Session identities", async () => {
    const root = await createTemporaryAgentDirectory();
    await expect(readIsolatedSessionIdentity(root)).rejects.toThrow(/requires the accepted/u);
    await expect(readIsolatedSessionIdentity(root, { expectedSessionId: "accepted" }))
      .rejects.toThrow(/exactly one/u);
    await Promise.all(["one", "two"].map((name) =>
      writeFile(join(root, "sessions", `${name}.jsonl`), '{"type":"session","id":"accepted"}\n')
    ));
    await expect(readIsolatedSessionIdentity(root, { expectedSessionId: "accepted" }))
      .rejects.toThrow(/exactly one/u);
  });

  it("excludes installed capabilities and unrelated JSONL from Session discovery", async () => {
    const root = await createTemporaryAgentDirectory();
    const content = '{"type":"session","id":"actual-session"}\n';
    await writeFile(join(root, "sessions", "session.jsonl"), content);
    await mkdir(join(root, "packages"));
    await Promise.all(Array.from({ length: 5 }, (_, index) =>
      writeFile(join(root, "packages", `package-${index}.jsonl`), "not a Session header\n")
    ));
    await expect(readIsolatedSessionIdentity(root, { expectedSessionId: "actual-session", discoveryLimit: 1 })).resolves.toMatchObject({
      id: "actual-session", relativePath: "sessions/session.jsonl"
    });
  });

  it("rejects oversized headers and unbounded directory discovery", async () => {
    const oversizedRoot = await createTemporaryAgentDirectory();
    await writeFile(
      join(oversizedRoot, "sessions", "oversized.jsonl"),
      `${JSON.stringify({ type: "session", id: "x".repeat(100) })}\n`,
      "utf8"
    );
    await expect(readIsolatedSessionIdentity(oversizedRoot, {
      expectedSessionId: "x".repeat(100),
      headerLimitBytes: 64
    })).rejects.toThrow(/header exceeds/u);

    const crowdedRoot = await createTemporaryAgentDirectory();
    await Promise.all([
      writeFile(join(crowdedRoot, "sessions", "one.jsonl"), '{"type":"session","id":"one"}\n'),
      writeFile(join(crowdedRoot, "sessions", "two.jsonl"), '{"type":"session","id":"two"}\n')
    ]);
    await expect(readIsolatedSessionIdentity(crowdedRoot, {
      expectedSessionId: "one",
      discoveryLimit: 1
    })).rejects.toThrow(/discovery exceeded/u);
  });
});

async function createTemporaryAgentDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-provider-session-"));
  temporaryDirectories.push(path);
  await mkdir(join(path, "sessions"));
  return path;
}
