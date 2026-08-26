import { describe, expect, it, vi } from "vitest";
import {
  createCloudflareR2Client,
  fetchPublicManifest
} from "./r2-update-cloudflare-client.mjs";

describe("Cloudflare R2 release client", () => {
  it("follows S3 continuation tokens without losing object pages", async () => {
    const s3Client = { send: vi.fn(async (command) => command.input.ContinuationToken
      ? { Contents: [{ Key: "second", Size: 2 }], IsTruncated: false }
      : {
          Contents: [{ Key: "first", Size: 1 }],
          IsTruncated: true,
          NextContinuationToken: "next-page"
        }) };
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client
    });

    await expect(client.listObjects()).resolves.toEqual([
      { key: "first", size: 1 },
      { key: "second", size: 2 }
    ]);
    expect(s3Client.send).toHaveBeenCalledTimes(2);
    expect(s3Client.send.mock.calls[1]?.[0].input.ContinuationToken).toBe("next-page");
  });

  it("streams large objects through the multipart-capable S3 uploader", async () => {
    const done = vi.fn(async () => undefined);
    const createUpload = vi.fn(() => ({ done }));
    const body = { stream: true };
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client: { send: vi.fn() },
      createUpload,
      statImpl: vi.fn(async () => ({ size: 359_483_990 })),
      createReadStreamImpl: vi.fn(() => body)
    });

    await client.putFile("candidate.dmg", "/candidate.dmg", "application/x-apple-diskimage");

    expect(createUpload).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        Bucket: "bucket",
        Key: "candidate.dmg",
        Body: body,
        ContentLength: 359_483_990,
        ContentType: "application/x-apple-diskimage"
      },
      leavePartsOnError: false
    }));
    expect(done).toHaveBeenCalledOnce();
  });

  it("sets explicit cache metadata when uploading mutable release metadata", async () => {
    const done = vi.fn(async () => undefined);
    const createUpload = vi.fn(() => ({ done }));
    const body = { stream: true };
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client: { send: vi.fn() },
      createUpload,
      statImpl: vi.fn(async () => ({ size: 898 })),
      createReadStreamImpl: vi.fn(() => body)
    });

    await client.putFile(
      "unsigned-preview-manifest.json",
      "/manifest.json",
      "application/json; charset=utf-8",
      "no-store"
    );

    expect(createUpload).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        CacheControl: "no-store",
        ContentType: "application/json; charset=utf-8"
      })
    }));
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
      s3Client: { send: vi.fn() },
      fetchImpl
    });
    const urls = Array.from({ length: 31 }, (_, index) => `https://updates.example/${index}`);

    await client.purgeExactUrls(urls);

    expect(requests).toEqual([{ files: urls.slice(0, 30) }, { files: urls.slice(30) }]);
  });

  it("rejects a cache purge whose Cloudflare envelope reports failure", async () => {
    const client = createCloudflareR2Client({
      accountId: "account",
      apiToken: "token",
      bucketName: "bucket",
      zoneId: "zone",
      s3Client: { send: vi.fn() },
      fetchImpl: vi.fn(async () => jsonResponse({ success: false, errors: [{ code: 1 }] }))
    });

    await expect(client.purgeExactUrls(["https://updates.example/artifact.exe"]))
      .rejects.toThrow("Cloudflare API request failed");
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

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
