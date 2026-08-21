import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadUnsignedUpdate } from "./unsigned-update-download.js";
import type { TrustedUpdateArtifact } from "./unsigned-preview-update.js";

const temporaryDirectories: string[] = [];

describe("unsigned update download", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("streams one fixed artifact, publishes progress, and atomically keeps verified bytes", async () => {
    const directory = await temporaryDirectory();
    const bytes = new TextEncoder().encode("verified update payload");
    const artifact = fixtureArtifact(bytes);
    const onProgress = vi.fn();
    const result = await downloadUnsignedUpdate({
      artifact,
      directory,
      fetcher: async () => response(bytes, artifact.url),
      signal: new AbortController().signal,
      onProgress
    });

    expect(result.artifact).toBe(artifact);
    expect(await readFile(result.path)).toEqual(Buffer.from(bytes));
    expect(onProgress).toHaveBeenLastCalledWith({
      transferred: bytes.byteLength,
      total: bytes.byteLength,
      percent: 100
    });
    expect(await readdir(directory)).toEqual([`pending-${artifact.name}`]);
  });

  it("removes partial bytes after a checksum or size failure", async () => {
    const directory = await temporaryDirectory();
    const bytes = new TextEncoder().encode("tampered");
    const artifact = { ...fixtureArtifact(bytes), sha256: "0".repeat(64) };
    await expect(downloadUnsignedUpdate({
      artifact,
      directory,
      fetcher: async () => response(bytes, artifact.url),
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })).rejects.toThrow("SHA-256");
    expect(await readdir(directory)).toEqual([]);

    await expect(downloadUnsignedUpdate({
      artifact: fixtureArtifact(bytes),
      directory,
      fetcher: async () => new Response(bytes, { headers: { "content-length": "999" } }),
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })).rejects.toThrow("size");
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects redirects before writing a verified file", async () => {
    const directory = await temporaryDirectory();
    const bytes = new TextEncoder().encode("payload");
    const artifact = fixtureArtifact(bytes);
    await expect(downloadUnsignedUpdate({
      artifact,
      directory,
      fetcher: async () => response(bytes, "https://example.invalid/update.exe"),
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })).rejects.toThrow("redirected");
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects a symbolic-link update directory before making a request", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "target");
    const directory = join(root, "updates");
    await mkdir(target);
    await symlink(target, directory);
    const bytes = new TextEncoder().encode("payload");
    const artifact = fixtureArtifact(bytes);
    const fetcher = vi.fn();

    await expect(downloadUnsignedUpdate({
      artifact,
      directory,
      fetcher,
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })).rejects.toThrow("update directory");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi67-update-download-"));
  temporaryDirectories.push(path);
  return path;
}

function fixtureArtifact(bytes: Uint8Array): TrustedUpdateArtifact {
  const name = "Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe";
  return {
    name,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    target: "windows-x64",
    url: `https://updates.52671314.xyz/${name}`
  };
}

function response(bytes: Uint8Array, url: string): Response {
  const result = new Response(Buffer.from(bytes), { headers: { "content-length": String(bytes.byteLength) } });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
