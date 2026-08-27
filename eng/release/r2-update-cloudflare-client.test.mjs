import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  createCloudflareR2Client,
  fetchPublicManifest,
  verifyPublicArtifact
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
    let progressListener;
    const createUpload = vi.fn(() => ({
      done: async () => {
        progressListener?.({ loaded: 200_000_000, total: 359_483_990 });
        await done();
      },
      on: vi.fn((_event, listener) => { progressListener = listener; })
    }));
    const body = { stream: true };
    const onTransferProgress = vi.fn();
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client: { send: vi.fn() },
      createUpload,
      statImpl: vi.fn(async () => ({ size: 359_483_990 })),
      createReadStreamImpl: vi.fn(() => body),
      onTransferProgress
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
    expect(onTransferProgress.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ phase: "start", transferredBytes: 0, totalBytes: 359_483_990 }),
      expect.objectContaining({ phase: "progress", transferredBytes: 200_000_000 }),
      expect.objectContaining({ phase: "complete", transferredBytes: 359_483_990 })
    ]);
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

  it("verifies existing R2 bytes before returning metadata for repair", async () => {
    const body = Buffer.from("verified R2 object");
    const artifact = {
      name: "candidate.zip",
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex")
    };
    const s3Client = {
      send: vi.fn(async () => ({
        Body: Readable.from([body]),
        CacheControl: "max-age=60",
        ContentDisposition: "attachment",
        ContentType: "application/octet-stream",
        ETag: '"r2-etag"',
        Metadata: { source: "candidate" }
      }))
    };
    const onTransferProgress = vi.fn();
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client,
      onTransferProgress
    });

    await expect(client.verifyObject(artifact)).resolves.toEqual({
      cacheControl: "max-age=60",
      contentType: "application/octet-stream",
      etag: '"r2-etag"',
      preservedMetadata: {
        ContentDisposition: "attachment",
        Metadata: { source: "candidate" }
      }
    });
    expect(s3Client.send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "bucket",
      Key: "candidate.zip"
    });
    expect(onTransferProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: "complete",
      operation: "r2-readback",
      transferredBytes: body.length
    }));
  });

  it("rejects an existing R2 object whose direct hash differs", async () => {
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client: {
        send: vi.fn(async () => ({
          Body: Readable.from([Buffer.from("wrong bytes")]),
          ETag: '"r2-etag"'
        }))
      }
    });

    await expect(client.verifyObject({
      name: "candidate.exe",
      bytes: 11,
      sha256: "a".repeat(64)
    })).rejects.toThrow("R2 SHA-256 mismatch");
  });

  it("conditionally replaces only HTTP metadata on a verified object", async () => {
    const s3Client = { send: vi.fn(async () => ({})) };
    const client = createCloudflareR2Client({
      accountId: "account",
      bucketName: "bucket",
      s3Client
    });

    await client.replaceObjectHttpMetadata("releases/candidate file.dmg", {
      contentType: "application/x-apple-diskimage",
      cacheControl: "public, max-age=31536000, immutable",
      etag: '"r2-etag"',
      preservedMetadata: {
        ContentDisposition: "attachment",
        Metadata: { source: "candidate" }
      }
    });

    expect(s3Client.send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "bucket",
      Key: "releases/candidate file.dmg",
      CopySource: "bucket/releases/candidate%20file.dmg",
      CopySourceIfMatch: '"r2-etag"',
      MetadataDirective: "REPLACE",
      ContentDisposition: "attachment",
      Metadata: { source: "candidate" },
      ContentType: "application/x-apple-diskimage",
      CacheControl: "public, max-age=31536000, immutable"
    });
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

  it("verifies public immutable cache metadata with full and Range reads", async () => {
    const body = Buffer.from("public artifact");
    const artifact = {
      name: "candidate.zip",
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex")
    };
    const cacheControl = "public, max-age=31536000, immutable";
    const fetchImpl = vi.fn(async (_url, init) => init?.headers?.Range
      ? new Response(body.subarray(0, 1), {
          status: 206,
          headers: {
            "cache-control": cacheControl,
            "content-range": `bytes 0-0/${body.length}`
          }
        })
      : new Response(body, { status: 200, headers: { "cache-control": cacheControl } }));

    const onTransferProgress = vi.fn();
    await expect(verifyPublicArtifact("https://updates.example", artifact, fetchImpl, onTransferProgress))
      .resolves.toBeUndefined();
    expect(onTransferProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: "complete",
      operation: "public-readback",
      transferredBytes: body.length
    }));
  });

  it("rejects a public artifact without the immutable origin cache policy", async () => {
    const body = Buffer.from("public artifact");
    const artifact = {
      name: "candidate.zip",
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex")
    };

    await expect(verifyPublicArtifact(
      "https://updates.example",
      artifact,
      vi.fn(async () => new Response(body, {
        status: 200,
        headers: { "cache-control": "max-age=31536000" }
      }))
    )).rejects.toThrow("immutable one-year artifact policy");
  });
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
