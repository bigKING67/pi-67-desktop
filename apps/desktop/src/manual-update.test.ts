import { describe, expect, it, vi } from "vitest";
import {
  MAX_RELEASE_RESPONSE_BYTES,
  RELEASES_API_URL,
  checkForUnsignedPreviewUpdate,
  readBoundedResponseText,
  releasePageUrl,
  selectLatestUnsignedPreview
} from "./manual-update.js";

describe("unsigned preview manual updates", () => {
  it("selects the latest complete prerelease using SemVer precedence", () => {
    const selected = selectLatestUnsignedPreview([
      release("0.1.0-alpha.1"),
      release("0.1.0-alpha.10"),
      release("0.1.0-alpha.2")
    ]);

    expect(selected?.version).toBe("0.1.0-alpha.10");
  });

  it("ignores drafts, stable releases, malformed tags, and incomplete assets", () => {
    const selected = selectLatestUnsignedPreview([
      release("9.0.0-alpha.1", { draft: true }),
      release("8.0.0", { prerelease: false }),
      release("7.0.0-alpha.1", { tag_name: "release-7" }),
      release("6.0.0-alpha.1", { assets: [] }),
      release("0.1.0-alpha.2")
    ]);

    expect(selected?.version).toBe("0.1.0-alpha.2");
  });

  it("rejects a non-array GitHub response", () => {
    expect(() => selectLatestUnsignedPreview({ releases: [] })).toThrow("must be an array");
  });

  it("processes at most the first 20 releases", () => {
    const releases = Array.from({ length: 20 }, (_, index) => release(`0.1.0-alpha.${index + 1}`, { assets: [] }));
    releases.push(release("9.0.0-alpha.1"));

    expect(selectLatestUnsignedPreview(releases)).toBeUndefined();
  });

  it("returns an available state without exposing release notes or a remote URL", async () => {
    const fetcher = vi.fn(async () => response([
      release("0.1.0-alpha.2", {
        html_url: "https://example.invalid/untrusted",
        body: "untrusted release notes"
      })
    ]));

    const state = await checkForUnsignedPreviewUpdate({ currentVersion: "0.1.0-alpha.1", fetcher });

    expect(state).toEqual({
      phase: "available",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      version: "0.1.0-alpha.2",
      releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
      publishedAt: "2026-07-23T06:00:00.000Z"
    });
    expect(JSON.stringify(state)).not.toContain("untrusted");
  });

  it("returns current when no complete preview is newer", async () => {
    const state = await checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.2",
      fetcher: async () => response([release("0.1.0-alpha.2"), release("0.1.0-alpha.1")])
    });

    expect(state).toEqual({
      phase: "current",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.2"
    });
  });

  it("sends only the fixed public GitHub request metadata", async () => {
    const requests: Array<[string, RequestInit]> = [];
    const fetcher = vi.fn(async (input: string, init: RequestInit) => {
      requests.push([input, init]);
      return response([release("0.1.0-alpha.1")]);
    });
    await checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      fetcher,
      signal: AbortSignal.abort()
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const request = requests[0];
    expect(request).toBeDefined();
    if (!request) throw new Error("Expected one GitHub Releases request.");
    const [url, init] = request;
    expect(url).toBe(RELEASES_API_URL);
    expect(init).toMatchObject({
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Pi-67-Desktop/0.1.0-alpha.1"
      }
    });
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("reports HTTP and invalid JSON failures without returning response bodies", async () => {
    await expect(checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      fetcher: async () => new Response("private upstream body", { status: 503 })
    })).rejects.toThrow("HTTP 503");
    await expect(checkForUnsignedPreviewUpdate({
      currentVersion: "0.1.0-alpha.1",
      fetcher: async () => new Response("not-json")
    })).rejects.toThrow("invalid JSON");
  });

  it("rejects invalid current and canonical release versions", async () => {
    await expect(checkForUnsignedPreviewUpdate({
      currentVersion: "not-semver",
      fetcher: async () => response([])
    })).rejects.toThrow("current application version");
    expect(() => releasePageUrl("../elsewhere")).toThrow("valid SemVer");
  });

  it("rejects declared and streamed bodies over 1 MiB", async () => {
    await expect(readBoundedResponseText(new Response("", {
      headers: { "content-length": String(MAX_RELEASE_RESPONSE_BYTES + 1) }
    }))).rejects.toThrow("1 MiB");
    await expect(readBoundedResponseText(new Response("x".repeat(MAX_RELEASE_RESPONSE_BYTES + 1)))).rejects.toThrow("1 MiB");
  });
});

function release(version: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draft: false,
    prerelease: true,
    tag_name: `v${version}`,
    published_at: "2026-07-23T06:00:00Z",
    assets: expectedAssets(version).map((name) => ({ name })),
    ...overrides
  };
}

function expectedAssets(version: string): string[] {
  return [
    `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`,
    `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`,
    `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`,
    "SHA256SUMS.txt",
    "unsigned-preview-manifest.json"
  ];
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
