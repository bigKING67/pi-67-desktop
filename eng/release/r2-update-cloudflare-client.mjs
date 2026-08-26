import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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

    async putFile(key, path, contentType, cacheControl) {
      const metadata = await statImpl(path);
      const upload = createUpload({
        client: objectClient,
        params: {
          Bucket: bucketName,
          Key: key,
          Body: createReadStreamImpl(path),
          ContentLength: metadata.size,
          ContentType: contentType,
          ...(cacheControl ? { CacheControl: cacheControl } : {})
        },
        queueSize: 4,
        partSize: 16 * 1024 * 1024,
        leavePartsOnError: false
      });
      await upload.done();
    },

    async verifyObject(artifact) {
      const response = await objectClient.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: artifact.name
      }));
      if (!response.Body) throw new Error(`${artifact.name}: R2 readback returned no body.`);
      const { bytes, sha256 } = await hashBody(response.Body);
      if (bytes !== artifact.bytes) throw new Error(`${artifact.name}: R2 byte count mismatch.`);
      if (sha256 !== artifact.sha256) throw new Error(`${artifact.name}: R2 SHA-256 mismatch.`);
      if (typeof response.ETag !== "string" || response.ETag.length === 0) {
        throw new Error(`${artifact.name}: R2 readback omitted the ETag required for conditional metadata repair.`);
      }
      return {
        cacheControl: response.CacheControl,
        contentType: response.ContentType,
        etag: response.ETag,
        preservedMetadata: {
          ...(response.ContentDisposition ? { ContentDisposition: response.ContentDisposition } : {}),
          ...(response.ContentEncoding ? { ContentEncoding: response.ContentEncoding } : {}),
          ...(response.ContentLanguage ? { ContentLanguage: response.ContentLanguage } : {}),
          ...(response.Expires ? { Expires: response.Expires } : {}),
          ...(response.Metadata ? { Metadata: response.Metadata } : {}),
          ...(response.WebsiteRedirectLocation
            ? { WebsiteRedirectLocation: response.WebsiteRedirectLocation }
            : {})
        }
      };
    },

    async replaceObjectHttpMetadata(key, { contentType, cacheControl, etag, preservedMetadata }) {
      await objectClient.send(new CopyObjectCommand({
        Bucket: bucketName,
        Key: key,
        CopySource: `${encodeURIComponent(bucketName)}/${encodeObjectKey(key)}`,
        CopySourceIfMatch: etag,
        MetadataDirective: "REPLACE",
        ...preservedMetadata,
        ContentType: contentType,
        CacheControl: cacheControl
      }));
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
  assertImmutableCacheControl(artifact.name, response.headers);
  const { bytes, sha256 } = await hashBody(response.body);
  if (bytes !== artifact.bytes) throw new Error(`${artifact.name}: public byte count mismatch.`);
  if (sha256 !== artifact.sha256) throw new Error(`${artifact.name}: public SHA-256 mismatch.`);

  const range = await fetchImpl(url, {
    cache: "no-store",
    headers: { Range: "bytes=0-0" },
    redirect: "error"
  });
  const rangeBytes = Buffer.from(await range.arrayBuffer());
  if (range.status !== 206 || rangeBytes.length !== 1) {
    throw new Error(`${artifact.name}: public Range probe did not return one-byte HTTP 206.`);
  }
  assertImmutableCacheControl(artifact.name, range.headers);
  const contentRange = range.headers.get("content-range");
  if (contentRange !== `bytes 0-0/${artifact.bytes}`) {
    throw new Error(`${artifact.name}: public Content-Range mismatch.`);
  }
}

async function hashBody(body) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

function assertImmutableCacheControl(name, headers) {
  const directives = new Set((headers.get("cache-control") ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean));
  if (!directives.has("public") || !directives.has("max-age=31536000") || !directives.has("immutable")) {
    throw new Error(`${name}: public Cache-Control is not the immutable one-year artifact policy.`);
  }
}

function encodeObjectKey(key) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function cloudflareEnvelope(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || payload?.success !== true) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}.`);
  }
  return payload;
}
