import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_DISCOVERY_LIMIT = 2_000;
const DEFAULT_HEADER_LIMIT_BYTES = 64 * 1024;

export async function readIsolatedSessionIdentity(agentDir, boundaries = {}) {
  const expectedSessionId = boundaries.expectedSessionId;
  if (typeof expectedSessionId !== "string" || !expectedSessionId || expectedSessionId.length > 512) {
    throw new Error("Provider Session discovery requires the accepted Session identity.");
  }
  const discoveryLimit = boundaries.discoveryLimit ?? DEFAULT_DISCOVERY_LIMIT;
  const headerLimitBytes = boundaries.headerLimitBytes ?? DEFAULT_HEADER_LIMIT_BYTES;
  const paths = await findJsonlFiles(join(agentDir, "sessions"), discoveryLimit);
  const candidates = [];
  for (const path of paths) {
    const metadata = await stat(path);
    const header = await readBoundedSessionHeader(path, metadata.size, headerLimitBytes);
    if (header?.type === "session" && header.id === expectedSessionId) {
      candidates.push({ path, metadata });
    }
  }
  if (candidates.length !== 1) {
    throw new Error("Accepted Pi Session identity must resolve to exactly one JSONL file.");
  }
  const selected = candidates[0];
  return {
    id: expectedSessionId,
    relativePath: relative(agentDir, selected.path).replaceAll("\\", "/"),
    byteLength: selected.metadata.size,
    sha256: await sha256File(selected.path)
  };
}

async function findJsonlFiles(root, discoveryLimit) {
  if (!Number.isSafeInteger(discoveryLimit) || discoveryLimit < 1) {
    throw new Error("Pi Session discovery limit must be a positive integer.");
  }
  const files = [];
  const pending = [root];
  let discoveredEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      discoveredEntries += 1;
      if (discoveredEntries > discoveryLimit) {
        throw new Error("Isolated Pi Session discovery exceeded the harness boundary.");
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }
  return files;
}

async function readBoundedSessionHeader(path, byteLength, headerLimitBytes) {
  if (!Number.isSafeInteger(headerLimitBytes) || headerLimitBytes < 1) {
    throw new Error("Pi Session header limit must be a positive integer.");
  }
  const bytesToRead = Math.min(byteLength, headerLimitBytes + 1);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await open(path, "r");
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(buffer, 0, bytesToRead, 0));
  } finally {
    await handle.close();
  }
  const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
  const lineEnd = newline >= 0 ? newline : bytesRead;
  if (lineEnd === 0) throw new Error("Pi JSONL Session header is missing.");
  if (lineEnd > headerLimitBytes || (newline < 0 && byteLength > bytesRead)) {
    throw new Error("Pi JSONL Session header exceeds the harness boundary.");
  }
  const firstLine = buffer.subarray(0, lineEnd).toString("utf8").replace(/\r$/u, "");
  try {
    return JSON.parse(firstLine);
  } catch {
    throw new Error("Pi JSONL Session header is not valid JSON.");
  }
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}
