import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export function createCloudflareR2Client({
  accountId,
  apiToken,
  bucketName,
  zoneId,
  fetchImpl = fetch
}) {
  const bucketUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/objects`;
  const authorizedHeaders = { Authorization: `Bearer ${apiToken}` };

  return {
    async listObjects() {
      const objects = [];
      let cursor;
      do {
        const url = new URL(bucketUrl);
        url.searchParams.set("per_page", "1000");
        if (cursor) url.searchParams.set("cursor", cursor);
        const payload = await cloudflareEnvelope(fetchImpl, url, { headers: authorizedHeaders });
        const page = payload.result;
        if (!Array.isArray(page)) throw new Error("Cloudflare R2 object list returned an invalid page.");
        objects.push(...page.map((entry) => ({ key: entry.key, size: Number(entry.size) })));
        cursor = payload.result_info?.is_truncated ? payload.result_info.cursor : undefined;
      } while (cursor);
      return objects;
    },

    async putFile(key, path, contentType) {
      const metadata = await stat(path);
      if (metadata.size > 300_000_000) {
        throw new Error(`${key}: Cloudflare REST object upload limit is 300 MB.`);
      }
      await cloudflareEnvelope(fetchImpl, `${bucketUrl}/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: {
          ...authorizedHeaders,
          "Content-Length": String(metadata.size),
          "Content-Type": contentType
        },
        body: createReadStream(path),
        duplex: "half"
      });
    },

    async deleteObject(key) {
      await cloudflareEnvelope(fetchImpl, `${bucketUrl}/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: authorizedHeaders
      });
    },

    async purgeExactUrls(urls) {
      if (urls.length === 0) return;
      if (!zoneId) throw new Error("PI67_CLOUDFLARE_ZONE_ID is required for exact cache purge.");
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
