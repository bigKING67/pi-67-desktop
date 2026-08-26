import { readdir } from "node:fs/promises";

const MAX_DIAGNOSTIC_STAGING_ENTRIES = 256;

export async function inspectPromptAttachmentStagingDirectory(path: string): Promise<{
  directoryCount: number;
  invalidEntryCount: number;
  truncated: boolean;
}> {
  const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  });
  let directoryCount = 0;
  let invalidEntryCount = 0;
  for (const entry of entries.slice(0, MAX_DIAGNOSTIC_STAGING_ENTRIES)) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) directoryCount += 1;
    else invalidEntryCount += 1;
  }
  return {
    directoryCount,
    invalidEntryCount,
    truncated: entries.length > MAX_DIAGNOSTIC_STAGING_ENTRIES
  };
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
