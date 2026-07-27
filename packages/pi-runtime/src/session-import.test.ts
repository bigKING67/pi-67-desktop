import { mkdtemp, open, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRuntimeError } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SESSION_IMPORT_BYTES,
  MAX_SESSION_IMPORT_LINE_BYTES,
  SessionImportLimitError,
  stageSessionImport
} from "./session-import.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("stageSessionImport resource limits", () => {
  it("rejects files over 256 MiB before creating a managed session directory", async () => {
    const root = await temporaryRoot();
    const sourcePath = join(root, "oversized.jsonl");
    const sessionDirectory = join(root, "managed");
    await writeFile(sourcePath, "source-prefix", "utf8");
    await truncate(sourcePath, MAX_SESSION_IMPORT_BYTES + 1);
    const prefixBefore = await readPrefix(sourcePath);

    const error = await stageSessionImport(sourcePath, sessionDirectory, root).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "SessionImportLimitError",
      code: "RESOURCE_LIMIT_EXCEEDED",
      limitCode: "SESSION_IMPORT_FILE_TOO_LARGE",
      limitBytes: MAX_SESSION_IMPORT_BYTES,
      details: {
        resource: "session-import",
        limitCode: "SESSION_IMPORT_FILE_TOO_LARGE",
        limitBytes: MAX_SESSION_IMPORT_BYTES
      }
    } satisfies Partial<SessionImportLimitError>);
    expect(isRuntimeError(error)).toBe(true);
    expect(exposedError(error)).not.toContain(sourcePath);
    expect(exposedError(error)).not.toContain("source-prefix");

    await expect(stat(sessionDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(sourcePath)).size).toBe(MAX_SESSION_IMPORT_BYTES + 1);
    expect(await readPrefix(sourcePath)).toEqual(prefixBefore);
  });

  it("rejects a physical line over 64 MiB before parsing or copying the source", async () => {
    const root = await temporaryRoot();
    const sourcePath = join(root, "oversized-line.jsonl");
    const sessionDirectory = join(root, "managed");
    await writeFile(sourcePath, "source-prefix", "utf8");
    await truncate(sourcePath, MAX_SESSION_IMPORT_LINE_BYTES + 1);
    const prefixBefore = await readPrefix(sourcePath);

    const error = await stageSessionImport(sourcePath, sessionDirectory, root).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "SessionImportLimitError",
      code: "RESOURCE_LIMIT_EXCEEDED",
      limitCode: "SESSION_IMPORT_LINE_TOO_LARGE",
      limitBytes: MAX_SESSION_IMPORT_LINE_BYTES,
      details: {
        resource: "session-import",
        limitCode: "SESSION_IMPORT_LINE_TOO_LARGE",
        limitBytes: MAX_SESSION_IMPORT_LINE_BYTES
      }
    } satisfies Partial<SessionImportLimitError>);
    expect(isRuntimeError(error)).toBe(true);
    expect(exposedError(error)).not.toContain(sourcePath);
    expect(exposedError(error)).not.toContain("source-prefix");

    await expect(stat(sessionDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(sourcePath)).size).toBe(MAX_SESSION_IMPORT_LINE_BYTES + 1);
    expect(await readPrefix(sourcePath)).toEqual(prefixBefore);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-import-test-"));
  temporaryRoots.push(root);
  return root;
}

async function readPrefix(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const prefix = Buffer.alloc(13);
    const { bytesRead } = await handle.read(prefix, 0, prefix.byteLength, 0);
    return prefix.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function exposedError(error: unknown): string {
  if (!(error instanceof Error)) return JSON.stringify(error);
  return JSON.stringify({
    message: error.message,
    details: "details" in error ? error.details : undefined
  });
}
