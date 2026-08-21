import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export function createCloudflareR2Client({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucketName,
  apiToken,
  zoneId,
  fetchImpl = fetch,
  s3Client,
  createUpload = (options) => new Upload(options),
  statImpl = stat,
  createReadStreamImpl = createReadStream
}) {
  const objectClient = s3Client ?? new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });

  return {
    async listObjects() {
      const objects = [];
      let continuationToken;
      do {
        const page = await objectClient.send(new ListObjectsV2Command({
          Bucket: bucketName,
          MaxKeys: 1000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {})
        }));
        if (!Array.isArray(page.Contents)) {
          if (page.Contents !== undefined) throw new Error("Cloudflare R2 object list returned an invalid page.");
        } else {
          for (const entry of page.Contents) {
            if (typeof entry.Key !== "string" || entry.Key.length === 0 || !Number.isSafeInteger(entry.Size)) {
              throw new Error("Cloudflare R2 object list returned invalid object metadata.");
            }
            objects.push({ key: entry.Key, size: entry.Size });
          }
        }
        if (page.IsTruncated && !page.NextContinuationToken) {
          throw new Error("Cloudflare R2 object list omitted its continuation token.");
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return objects;
    },

    async putFile(key, path, contentType) {
      const metadata = await statImpl(path);
      const upload = createUpload({
        client: objectClient,
        params: {
          Bucket: bucketName,
          Key: key,
          Body: createReadStreamImpl(path),
          ContentLength: metadata.size,
          ContentType: contentType
        },
        queueSize: 4,
        partSize: 16 * 1024 * 1024,
        leavePartsOnError: false
      });
      await upload.done();
    },

    async deleteObject(key) {
      await objectClient.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    },

    async purgeExactUrls(urls) {
      if (urls.length === 0) return;
      if (!zoneId) throw new Error("PI67_CLOUDFLARE_ZONE_ID is required for exact cache purge.");
      if (!apiToken) throw new Error("PI67_CLOUDFLARE_API_TOKEN is required for exact cache purge.");
      const authorizedHeaders = { Authorization: `Bearer ${apiToken}` };
      for (let offset = 0; offset < urls.length; offset += 30) {
        await cloudflareEnvelope(
          fetchImpl,
          `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
          {
            method: "POST",
            headers: { ...authorizedHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ files: urls.slice(offset, offset + 30) })
          }
        );
      }
    }
  };
}

export async function fetchPublicManifest(origin, fetchImpl = fetch) {
  const response = await fetchImpl(`${origin}/unsigned-preview-manifest.json`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    redirect: "error"
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public update manifest returned HTTP ${response.status}.`);
  const expectedUrl = `${origin}/unsigned-preview-manifest.json`;
  if (response.url.length > 0 && response.url !== expectedUrl) {
    throw new Error("Public update manifest redirected away from the fixed update origin.");
  }
  return response.json();
}

export async function verifyPublicArtifact(origin, artifact, fetchImpl = fetch) {
  const url = `${origin}/${encodeURIComponent(artifact.name)}`;
  const response = await fetchImpl(url, { cache: "no-store", redirect: "error" });
  if (response.status !== 200 || !response.body) {
    throw new Error(`${artifact.name}: public readback returned HTTP ${response.status}.`);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  if (bytes !== artifact.bytes) throw new Error(`${artifact.name}: public byte count mismatch.`);
  if (hash.digest("hex") !== artifact.sha256) throw new Error(`${artifact.name}: public SHA-256 mismatch.`);

  const range = await fetchImpl(url, {
    cache: "no-store",
    headers: { Range: "bytes=0-0" },
    redirect: "error"
  });
  const rangeBytes = Buffer.from(await range.arrayBuffer());
  if (range.status !== 206 || rangeBytes.length !== 1) {
    throw new Error(`${artifact.name}: public Range probe did not return one-byte HTTP 206.`);
  }
  const contentRange = range.headers.get("content-range");
  if (contentRange !== `bytes 0-0/${artifact.bytes}`) {
    throw new Error(`${artifact.name}: public Content-Range mismatch.`);
  }
}

async function cloudflareEnvelope(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.success !== true) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}.`);
  }
  return payload;
}
