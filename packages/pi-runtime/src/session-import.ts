import { constants } from "node:fs";
import { copyFile, mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const MAX_IMPORT_NAME_ATTEMPTS = 1_000;

export interface StagedSessionImport {
  copied: boolean;
  path: string;
  sessionManager: SessionManager;
}

export async function resolveManagedSessionPath(path: string, cwd: string, agentDir: string): Promise<string> {
  const configuredDirectory = SettingsManager.create(cwd, agentDir).getSessionDir();
  const managedRoot = configuredDirectory ?? join(agentDir, "sessions");
  const [resolvedPath, resolvedRoot] = await Promise.all([
    realpath(resolve(path)),
    realpath(resolve(managedRoot))
  ]);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Only managed Pi sessions can be opened directly. Import external JSONL first.");
  }
  return resolvedPath;
}

export async function stageSessionImport(
  sourcePath: string,
  sessionDirectory: string,
  cwdOverride: string
): Promise<StagedSessionImport> {
  const resolvedSource = await realpath(resolve(sourcePath));
  const sourceStats = await stat(resolvedSource);
  if (!sourceStats.isFile()) throw new Error("The selected Pi session is not a regular file.");

  // Parse the source before creating a managed copy so invalid JSONL leaves no artifact.
  const sourceManager = SessionManager.open(resolvedSource, undefined, cwdOverride);
  await mkdir(sessionDirectory, { recursive: true });
  const resolvedSessionDirectory = await realpath(resolve(sessionDirectory));
  if (dirname(resolvedSource) === resolvedSessionDirectory) {
    return {
      copied: false,
      path: resolvedSource,
      sessionManager: SessionManager.open(resolvedSource, resolvedSessionDirectory, cwdOverride)
    };
  }

  const destination = await copyWithoutOverwrite(resolvedSource, resolvedSessionDirectory);
  try {
    return {
      copied: true,
      path: destination,
      sessionManager: SessionManager.open(destination, resolvedSessionDirectory, sourceManager.getCwd())
    };
  } catch (error) {
    await removeStagedSessionImport(destination, error);
    throw error;
  }
}

export async function discardStagedSessionImport(staged: StagedSessionImport, cause: unknown): Promise<void> {
  if (!staged.copied) return;
  await removeStagedSessionImport(staged.path, cause);
}

async function copyWithoutOverwrite(sourcePath: string, sessionDirectory: string): Promise<string> {
  const sourceName = basename(sourcePath);
  for (let attempt = 0; attempt < MAX_IMPORT_NAME_ATTEMPTS; attempt += 1) {
    const destination = join(sessionDirectory, importFileName(sourceName, attempt));
    try {
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if (isNodeError(error, "EEXIST")) continue;
      throw error;
    }
  }
  throw new Error("Unable to allocate a unique filename for the imported Pi session.");
}

function importFileName(sourceName: string, attempt: number): string {
  if (attempt === 0) return sourceName;
  const extension = extname(sourceName);
  const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;
  return `${stem}-imported-${attempt}${extension}`;
}

async function removeStagedSessionImport(path: string, cause: unknown): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (cleanupError) {
    throw new AggregateError([cause, cleanupError], "Pi session import failed and its managed copy could not be removed.");
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
