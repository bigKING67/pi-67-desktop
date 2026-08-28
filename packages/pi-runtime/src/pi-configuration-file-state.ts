import { createHash } from "node:crypto";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SettingsManager as PiSettingsManager } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";
import type {
  PiConfigurationFileKind,
  PiConfigurationFileStatus,
  PiConfigurationReloadState,
  PiProviderConfigurationChanged,
  PiProviderConfigurationSnapshot
} from "@pi67/protocol";
import { writePrivateFileAtomically } from "./atomic-private-file.js";
import { PiAuthContentChangedError } from "./pi-auth-credential-store.js";
import { withPiConfigurationBudget } from "./pi-configuration-service-options.js";

export interface PiConfigurationPaths {
  modelsPath: string;
  authPath: string;
  globalSettingsPath: string;
}

export interface ConfigurationPathState {
  kind: PiConfigurationFileKind;
  path: string;
  content?: string;
  exists: boolean;
  modifiedAt?: number;
  revision: string;
}

export interface WorkspaceBundle {
  paths: ConfigurationPathState[];
  byKind: Record<PiConfigurationFileKind, ConfigurationPathState>;
  revision: string;
}

export interface ModelConfigurationBundle {
  models: ConfigurationPathState;
  auth: ConfigurationPathState;
}

export interface WorkspaceConfigurationState {
  cwd: string;
  settingsManager: PiSettingsManager;
  projectTrusted: boolean;
  registrations: number;
  listeners: Set<(change: PiProviderConfigurationChanged) => void>;
  runtimes: Set<{
    requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState>;
    requestModelCatalogReload(): Promise<PiConfigurationReloadState>;
  }>;
  snapshot?: PiProviderConfigurationSnapshot;
  fileRevisions?: Record<PiConfigurationFileKind, string>;
  projectWatcher?: FSWatcher;
}

interface PiConfigurationWatcherOptions {
  agentDir: string;
  fallbackPollMs: number;
  watchDebounceMs: number;
  workspaces: Map<string, WorkspaceConfigurationState>;
  isDisposed(): boolean;
  refresh(): Promise<void>;
}

export class PiConfigurationWatcher {
  private globalWatcher: FSWatcher | undefined;
  private fallbackTimer: ReturnType<typeof setInterval> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PiConfigurationWatcherOptions) {}

  start(): void {
    this.ensureDirectoryWatchers();
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => this.schedule(), this.options.fallbackPollMs);
    this.fallbackTimer.unref?.();
  }

  ensureDirectoryWatchers(): void {
    this.globalWatcher ??= createDirectoryWatcher(this.options.agentDir, () => this.schedule());
    for (const state of this.options.workspaces.values()) {
      if (state.projectWatcher) continue;
      const watcher = createDirectoryWatcher(join(state.cwd, ".pi"), () => this.schedule());
      if (watcher) state.projectWatcher = watcher;
    }
  }

  schedule(): void {
    if (this.options.isDisposed()) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.options.refresh().catch(() => undefined);
    }, this.options.watchDebounceMs);
    this.debounceTimer.unref?.();
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.globalWatcher?.close();
    this.globalWatcher = undefined;
    for (const state of this.options.workspaces.values()) state.projectWatcher?.close();
  }
}

export async function readWorkspaceConfigurationBundle(
  paths: PiConfigurationPaths,
  state: WorkspaceConfigurationState,
  fileAccessWaitMs: number
): Promise<WorkspaceBundle> {
  const projectPath = join(state.cwd, ".pi", "settings.json");
  const entries = await Promise.all([
    readConfigurationPath("models", paths.modelsPath, true, fileAccessWaitMs),
    readConfigurationPath("auth", paths.authPath, true, fileAccessWaitMs),
    readConfigurationPath("global-settings", paths.globalSettingsPath, true, fileAccessWaitMs),
    readConfigurationPath("project-settings", projectPath, state.projectTrusted, fileAccessWaitMs)
  ]);
  const byKind = Object.fromEntries(entries.map((entry) => [entry.kind, entry])) as WorkspaceBundle["byKind"];
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry.kind).update("\0").update(entry.revision).update("\0");
  return { paths: entries, byKind, revision: hash.digest("hex") };
}

export async function readModelConfigurationBundle(
  paths: PiConfigurationPaths,
  fileAccessWaitMs: number
): Promise<ModelConfigurationBundle> {
  const [models, auth] = await Promise.all([
    readConfigurationPath("models", paths.modelsPath, true, fileAccessWaitMs),
    readConfigurationPath("auth", paths.authPath, true, fileAccessWaitMs)
  ]);
  return { models, auth };
}

export function configurationPath(
  paths: PiConfigurationPaths,
  state: WorkspaceConfigurationState,
  kind: PiConfigurationFileKind
): string {
  if (kind === "models") return paths.modelsPath;
  if (kind === "auth") return paths.authPath;
  if (kind === "global-settings") return paths.globalSettingsPath;
  return join(state.cwd, ".pi", "settings.json");
}

export async function readOptionalConfigurationFile(path: string, fileAccessWaitMs: number): Promise<string | undefined> {
  return withPiConfigurationBudget(
    readFile(path, "utf8"),
    fileAccessWaitMs,
    "configuration-file-access"
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export function fileStatus(path: ConfigurationPathState, valid: boolean): PiConfigurationFileStatus {
  return {
    kind: path.kind,
    path: path.path,
    exists: path.exists,
    valid,
    ...(path.modifiedAt === undefined ? {} : { modifiedAt: path.modifiedAt })
  };
}

export function fileRevisionRecord(
  paths: WorkspaceBundle["byKind"]
): Record<PiConfigurationFileKind, string> {
  return {
    models: paths.models.revision,
    auth: paths.auth.revision,
    "global-settings": paths["global-settings"].revision,
    "project-settings": paths["project-settings"].revision
  };
}

export function changedConfigurationFiles(
  previous: Record<PiConfigurationFileKind, string> | undefined,
  next: WorkspaceBundle["byKind"]
): PiConfigurationFileKind[] {
  if (!previous) return ["models", "auth", "global-settings", "project-settings"];
  return (Object.keys(previous) as PiConfigurationFileKind[])
    .filter((kind) => previous[kind] !== next[kind].revision);
}

export function assertExpectedConfigurationRevision(bundle: WorkspaceBundle, expectedRevision: string): void {
  if (bundle.revision === expectedRevision) return;
  throw new RuntimeError(
    "CONFIGURATION_CHANGED_EXTERNALLY",
    "Pi configuration changed outside Desktop. Reload before saving this draft.",
    { recoverable: true, details: { expectedRevision, actualRevision: bundle.revision } }
  );
}

export async function restoreConfigurationFile(path: string, previous: string | undefined): Promise<void> {
  if (previous === undefined) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  await writePrivateFileAtomically(path, previous);
}

export function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function normalizeConfigurationMutationError(error: unknown): unknown {
  if (error instanceof PiAuthContentChangedError) {
    return new RuntimeError(
      "CONFIGURATION_CHANGED_EXTERNALLY",
      "Pi auth.json changed outside Desktop. Reload before saving this credential.",
      { recoverable: true }
    );
  }
  return error;
}

export function configurationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readConfigurationPath(
  kind: PiConfigurationFileKind,
  path: string,
  readContent: boolean,
  fileAccessWaitMs: number
): Promise<ConfigurationPathState> {
  const metadata = await withPiConfigurationBudget(
    stat(path),
    fileAccessWaitMs,
    "configuration-file-access"
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const content = metadata && readContent
    ? await withPiConfigurationBudget(
        readFile(path, "utf8"),
        fileAccessWaitMs,
        "configuration-file-access"
      )
    : undefined;
  const revision = createHash("sha256")
    .update(metadata ? "present\0" : "missing\0")
    .update(readContent ? content ?? "" : "untrusted")
    .digest("hex");
  return {
    kind,
    path,
    ...(content === undefined ? {} : { content }),
    exists: metadata !== undefined,
    ...(metadata ? { modifiedAt: metadata.mtimeMs } : {}),
    revision
  };
}

function createDirectoryWatcher(path: string, onDirty: () => void): FSWatcher | undefined {
  try {
    // Native canonical paths avoid libuv short-path/long-path mismatches on Windows.
    const watcher = watch(realpathSync.native(path), { persistent: false }, onDirty);
    watcher.on("error", () => undefined);
    return watcher;
  } catch {
    return undefined;
  }
}
