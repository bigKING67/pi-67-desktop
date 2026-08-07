import { join, resolve } from "node:path";

export const SESSION_CATALOG_SIZES = Object.freeze({
  small: 1_000,
  large: 10_000
});

export const SESSION_CATALOG_NEEDLE_INDEX = 6_789;

const BASE_TIMESTAMP_MS = Date.UTC(2026, 6, 24, 0, 0, 0);
const ALLOWED_RECORD_KEYS = new Set([
  "cwd",
  "cwdKey",
  "explicitName",
  "fileIdentity",
  "id",
  "messageCount",
  "modifiedAt",
  "parentSessionPath",
  "path"
]);

export function createSessionCatalogRecords(count, workspace, normalizeCwd = defaultNormalizeCwd) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Session Catalog fixture count must be a positive safe integer.");
  }
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error("Session Catalog fixture workspace must be a non-empty path.");
  }

  const cwdKey = normalizeCwd(workspace);
  if (typeof cwdKey !== "string" || cwdKey.length === 0) {
    throw new Error("Session Catalog fixture cwd normalizer returned an invalid key.");
  }

  return Array.from({ length: count }, (_, index) => {
    const padded = index.toString().padStart(5, "0");
    return {
      fileIdentity: `session-file-${padded}`,
      id: `session-${padded}`,
      path: join(workspace, "sessions", `session-${padded}.jsonl`),
      cwd: workspace,
      cwdKey,
      explicitName: index === SESSION_CATALOG_NEEDLE_INDEX
        ? `Session catalog needle ${padded}`
        : `Session ${padded}`,
      modifiedAt: BASE_TIMESTAMP_MS - index * 1_000,
      messageCount: index % 100
    };
  });
}

export function createSessionCatalogContext(records, workspace, sourceKey) {
  if (!Array.isArray(records)) throw new Error("Session Catalog context requires metadata records.");
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error("Session Catalog context requires a workspace path.");
  }
  if (typeof sourceKey !== "string" || sourceKey.length === 0) {
    throw new Error("Session Catalog context requires a source key.");
  }
  return {
    sourceKey,
    workspaceCwd: workspace,
    discover: async () => ({
      records,
      incomplete: false,
      skippedCount: 0
    })
  };
}

export function assertMetadataOnlyRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Session Catalog performance fixture must contain metadata records.");
  }
  for (const [index, record] of records.entries()) {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new Error(`Session Catalog fixture record ${index} is not an object.`);
    }
    for (const key of Object.keys(record)) {
      if (!ALLOWED_RECORD_KEYS.has(key)) {
        throw new Error(`Session Catalog fixture record ${index} contains non-metadata field ${key}.`);
      }
    }
    for (const key of ["fileIdentity", "id", "path", "cwd", "cwdKey", "explicitName"]) {
      if (typeof record[key] !== "string" || record[key].length === 0) {
        throw new Error(`Session Catalog fixture record ${index} has invalid ${key} metadata.`);
      }
    }
    if (!Number.isSafeInteger(record.modifiedAt) || !Number.isSafeInteger(record.messageCount)) {
      throw new Error(`Session Catalog fixture record ${index} has invalid numeric metadata.`);
    }
  }
}

function defaultNormalizeCwd(cwd) {
  const resolved = resolve(cwd);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
