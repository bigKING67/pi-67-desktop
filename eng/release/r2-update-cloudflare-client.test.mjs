import { describe, expect, it, vi } from "vitest";
import {
  createCloudflareR2Client,
  fetchPublicManifest
} from "./r2-update-cloudflare-client.mjs";

describe("Cloudflare R2 release client", () => {
  it("follows result_info cursors without losing object pages", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const cursor = new URL(String(url)).searchParams.get("cursor");
      return jsonResponse(cursor
        ? envelope([{ key: "second", size: 2 }], false)
        : envelope([{ key: "first", size: 1 }], true, "next-page"));
    });
    const client = createCloudflareR2Client({
      accountId: "account",
      apiToken: "token",
      bucketName: "bucket",
      fetchImpl
    });

    await expect(client.listObjects()).resolves.toEqual([
      { key: "first", size: 1 },
      { key: "second", size: 2 }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get("cursor")).toBe("next-page");
  });

  it("purges only the supplied exact URLs in bounded batches", async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return jsonResponse({ success: true, result: { id: "purge" } });
    });
    const client = createCloudflareR2Client({
      accountId: "account",
      apiToken: "token",
      bucketName: "bucket",
      zoneId: "zone",
      fetchImpl
    });
    const urls = Array.from({ length: 31 }, (_, index) => `https://updates.example/${index}`);

    await client.purgeExactUrls(urls);

    expect(requests).toEqual([{ files: urls.slice(0, 30) }, { files: urls.slice(30) }]);
  });

  it("rejects a successful HTTP mutation whose Cloudflare envelope reports failure", async () => {
    const client = createCloudflareR2Client({
      accountId: "account",
      apiToken: "token",
      bucketName: "bucket",
      fetchImpl: vi.fn(async () => jsonResponse({ success: false, errors: [{ code: 1 }] }))
    });

    await expect(client.deleteObject("artifact.exe")).rejects.toThrow("Cloudflare API request failed");
  });

  it("rejects a public manifest that resolves away from the fixed URL", async () => {
    const response = jsonResponse({ version: "0.1.0-alpha.30" });
    Object.defineProperty(response, "url", { value: "https://redirect.invalid/manifest.json" });

    await expect(fetchPublicManifest(
      "https://updates.52671314.xyz",
      vi.fn(async () => response)
    )).rejects.toThrow("redirected");
  });
});

function envelope(result, isTruncated, cursor) {
  return {
    success: true,
    result,
    result_info: { is_truncated: isTruncated, ...(cursor ? { cursor } : {}) }
  };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
