import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import { withConfigurationFileLock } from "./atomic-private-file.js";
import {
  type PiAuthCredentialMutationResult,
  type PiAuthCredentialStore
} from "./pi-auth-credential-store.js";
import {
  normalizeConfigurationMutationError,
  readOptionalConfigurationFile,
  restoreConfigurationFile
} from "./pi-configuration-file-state.js";

interface CommitPiCredentialMutationOptions {
  authPath: string;
  credentials: PiAuthCredentialStore;
  fileAccessWaitMs: number;
  mutate(): Promise<PiAuthCredentialMutationResult>;
  createValidationRuntime(): Promise<ModelRuntime>;
}

export interface CommittedPiCredentialMutation {
  result: PiAuthCredentialMutationResult;
  runtime: ModelRuntime;
  restoreStore(content: string | undefined): void;
}

/** Validates one auth.json write and rolls back only if that exact write still owns the file. */
export async function commitPiCredentialMutation(
  options: CommitPiCredentialMutationOptions
): Promise<CommittedPiCredentialMutation> {
  let result: PiAuthCredentialMutationResult | undefined;
  try {
    result = await options.mutate();
    const runtime = await options.createValidationRuntime();
    await runtime.listCredentials();
    return {
      result,
      runtime,
      restoreStore: (content) => restoreCredentialStore(
        options.credentials,
        content,
        result!.previousContent
      )
    };
  } catch (error) {
    if (result) await rollbackCredentialMutation(options, result);
    throw normalizeConfigurationMutationError(error);
  }
}

async function rollbackCredentialMutation(
  options: CommitPiCredentialMutationOptions,
  result: PiAuthCredentialMutationResult
): Promise<void> {
  let conflictingContent: string | undefined;
  let changedExternally = false;
  await withConfigurationFileLock(options.authPath, async () => {
    const current = await readOptionalConfigurationFile(
      options.authPath,
      options.fileAccessWaitMs
    );
    if (current !== result.writtenContent) {
      conflictingContent = current;
      changedExternally = true;
      return;
    }
    await restoreConfigurationFile(options.authPath, result.previousContent);
  });
  restoreCredentialStore(
    options.credentials,
    changedExternally ? conflictingContent : result.previousContent,
    result.previousContent
  );
  if (changedExternally) throw credentialChangedExternally();
}

function restoreCredentialStore(
  credentials: PiAuthCredentialStore,
  currentContent: string | undefined,
  lastKnownGoodContent: string | undefined
): void {
  if (credentials.loadContent(currentContent) === undefined) return;
  const fallbackError = credentials.loadContent(lastKnownGoodContent);
  if (fallbackError) {
    throw new Error(`Pi could not restore the last-known-good credential state: ${fallbackError}`);
  }
}

function credentialChangedExternally(): RuntimeError {
  return new RuntimeError(
    "CONFIGURATION_CHANGED_EXTERNALLY",
    "Pi auth.json changed again while Desktop was validating the saved credential.",
    { recoverable: true }
  );
}
