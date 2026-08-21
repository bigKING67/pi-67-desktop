import { describe, expect, it, vi } from "vitest";
import {
  MAX_UPDATE_MANIFEST_BYTES,
  UPDATE_MANIFEST_URL,
  checkForUnsignedPreviewUpdate,
  parseUnsignedPreviewManifest,
  readBoundedResponseText
} from "./unsigned-preview-update.js";

describe("unsigned preview R2 update manifest", () => {
  it("selects the exact Windows artifact from a newer complete manifest", async () => {
    const fetcher = vi.fn(async () => response(manifest("0.1.0-alpha.2"), UPDATE_MANIFEST_URL));

    const checked = await checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      platform: "win32",
      fetcher
    });

    expect(checked).toEqual({
      state: {
        phase: "available",
        channel: "unsigned-preview",
        currentVersion: "0.1.0-alpha.1",
        version: "0.1.0-alpha.2",
        artifactName: "Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe",
        artifactBytes: 1_000
      },
      artifact: {
        name: "Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe",
        bytes: 1_000,
        sha256: hash("a"),
        target: "windows-x64",
        url: "https://updates.52671314.xyz/Pi-67-Desktop-0.1.0-alpha.2-win-x64-unsigned-preview.exe"
      }
    });
    expect(fetcher).toHaveBeenCalledWith(UPDATE_MANIFEST_URL, expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "User-Agent": "Pi-67-Desktop/0.1.0-alpha.1"
      }
    }));
  });

  it("selects ZIP for macOS and keeps equal or older versions current", async () => {
    const available = await checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      platform: "darwin",
      fetcher: async () => response(manifest("0.1.0-alpha.2"), UPDATE_MANIFEST_URL)
    });
    expect(available.artifact?.name).toBe("Pi-67-Desktop-0.1.0-alpha.2-mac-arm64-unsigned-preview.zip");

    const current = await checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.2",
      platform: "darwin",
      fetcher: async () => response(manifest("0.1.0-alpha.2"), UPDATE_MANIFEST_URL)
    });
    expect(current).toEqual({
      state: {
        phase: "current",
        channel: "unsigned-preview",
        currentVersion: "0.1.0-alpha.2"
      }
    });
  });

  it("rejects incomplete, duplicated, oversized, and remotely named artifacts", () => {
    const missing = manifest("0.1.0-alpha.2");
    missing.files.pop();
    expect(() => parseUnsignedPreviewManifest(missing)).toThrow("identity");

    const duplicate = manifest("0.1.0-alpha.2");
    duplicate.files[2] = { ...duplicate.files[0]! };
    expect(() => parseUnsignedPreviewManifest(duplicate)).toThrow("duplicate");

    const oversized = manifest("0.1.0-alpha.2");
    oversized.files[0]!.bytes = Number.MAX_SAFE_INTEGER;
    expect(() => parseUnsignedPreviewManifest(oversized)).toThrow("invalid");

    const remote = manifest("0.1.0-alpha.2");
    remote.files[0]!.name = "https://example.invalid/update.exe";
    expect(() => parseUnsignedPreviewManifest(remote)).toThrow("invalid");
  });

  it("rejects HTTP failures, cross-origin redirects, invalid SemVer, and oversized bodies", async () => {
    await expect(checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      platform: "win32",
      fetcher: async () => new Response("unavailable", { status: 503 })
    })).rejects.toThrow("HTTP 503");

    await expect(checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      platform: "win32",
      fetcher: async () => response(manifest("0.1.0-alpha.2"), "https://example.invalid/manifest.json")
    })).rejects.toThrow("fixed URL");

    await expect(checkForUnsignedPreviewUpdate({
      currentVersion: "not-semver",
      platform: "win32",
      fetcher: vi.fn()
    })).rejects.toThrow("current application version");

    await expect(readBoundedResponseText(new Response("", {
      headers: { "content-length": String(MAX_UPDATE_MANIFEST_BYTES + 1) }
    }))).rejects.toThrow("1 MiB");
  });
});

function manifest(version: string): {
  schemaVersion: number;
  product: string;
  version: string;
  channel: string;
  signed: boolean;
  runtime: string;
  files: Array<{ name: string; bytes: number; sha256: string; target: string }>;
} {
  return {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: "@earendil-works/pi-coding-agent@0.55.3",
    files: [
      {
        name: `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`,
        bytes: 1_000,
        sha256: hash("a"),
        target: "windows-x64"
      },
      {
        name: `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`,
        bytes: 2_000,
        sha256: hash("b"),
        target: "macos-arm64"
      },
      {
        name: `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`,
        bytes: 3_000,
        sha256: hash("c"),
        target: "macos-arm64"
      }
    ]
  };
}

function response(value: unknown, url = ""): Response {
  const result = new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  if (url) Object.defineProperty(result, "url", { value: url });
  return result;
}

function hash(character: string): string {
  return character.repeat(64);
}
