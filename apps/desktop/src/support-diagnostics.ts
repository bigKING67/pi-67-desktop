import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { normalize, resolve, join } from "node:path";
import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow
} from "electron";
import {
  isSupportDiagnosticsExportRequest,
  type DesktopRecoverySnapshot,
  type SupportDiagnosticsExportRequest
} from "@pi67/protocol";
import type { AgentHostSupervisorDiagnostics } from "./agent-host-supervisor.js";
import { resolveDesktopAgentDirectory } from "./desktop-agent-directory.js";
import { redact } from "./redaction.js";

export const MAX_DIAGNOSTIC_CONFIGURATION_BYTES = 1_048_576;

type PiConfigurationDiagnosticFileName = "auth.json" | "settings.json" | "models.json";

interface PiConfigurationFileDiagnostic {
  file: PiConfigurationDiagnosticFileName;
  state:
    | "missing"
    | "valid-json"
    | "invalid-json"
    | "unreadable"
    | "not-file"
    | "symlink"
    | "oversized"
    | "directory-unavailable";
  sizeBytes?: number;
  modifiedAt?: number;
  errorClass?: DiagnosticFileErrorClass;
}

export interface PiConfigurationDiagnostics {
  agentDirectory: {
    pathHash: string;
    pathKind: "drive" | "unc" | "posix";
    source: "default" | "environment";
    state: "available" | "missing" | "unreadable" | "not-directory" | "symlink";
    containsSpaces: boolean;
    containsNonAscii: boolean;
    lengthClass: "short" | "medium" | "long" | "extended";
    currentEnvironmentMatchesAuthority: boolean;
    errorClass?: DiagnosticFileErrorClass;
  };
  files: PiConfigurationFileDiagnostic[];
}

type DiagnosticFileErrorClass =
  | "access-denied"
  | "io"
  | "not-directory"
  | "path-loop"
  | "unknown";

const CONFIGURATION_FILES: readonly PiConfigurationDiagnosticFileName[] = [
  "auth.json",
  "settings.json",
  "models.json"
];

export function registerSupportDiagnosticsBridge(options: {
  agentDirectory: string;
  agentDirectorySource: "default" | "environment";
  getAgentHostDiagnostics: () => AgentHostSupervisorDiagnostics;
  getMainWindow: () => BrowserWindow | undefined;
  recoverySnapshot: () => Promise<DesktopRecoverySnapshot>;
}): void {
  ipcMain.handle("pi67:save-diagnostics", async (_event, value: unknown) => {
    if (!isSupportDiagnosticsExportRequest(value)) throw new Error("Invalid diagnostic payload.");
    const request: SupportDiagnosticsExportRequest = value;
    const result = await dialog.showSaveDialog(options.getMainWindow()!, {
      title: "保存脱敏诊断",
      defaultPath: `pi67-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return undefined;
    const piConfiguration = await collectPiConfigurationDiagnostics({
      agentDirectory: options.agentDirectory,
      agentDirectorySource: options.agentDirectorySource
    });
    const supportDiagnostics = {
      schema: "pi67-support-diagnostics.v2" as const,
      generatedAt: Date.now(),
      application: {
        version: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
        packaged: app.isPackaged
      },
      desktop: await options.recoverySnapshot(),
      agentHost: options.getAgentHostDiagnostics(),
      piConfiguration,
      runtimeCollection: request.runtimeCollection,
      ...("runtime" in request ? { runtime: request.runtime } : {})
    };
    const serialized = `${JSON.stringify(supportDiagnostics, null, 2)}\n`;
    await writeFile(result.filePath, redact(serialized), { encoding: "utf8", mode: 0o600 });
    return result.filePath;
  });
}

export async function collectPiConfigurationDiagnostics(options: {
  agentDirectory: string;
  agentDirectorySource: "default" | "environment";
  environment?: NodeJS.ProcessEnv;
}): Promise<PiConfigurationDiagnostics> {
  const agentDirectory = resolve(options.agentDirectory);
  const directory = await inspectDirectory(agentDirectory);
  const environment = options.environment ?? process.env;
  const currentEnvironmentDirectory = resolveDesktopAgentDirectory(environment);
  const files = directory.state === "available"
    ? await Promise.all(CONFIGURATION_FILES.map((file) => inspectConfigurationFile(agentDirectory, file)))
    : CONFIGURATION_FILES.map((file) => ({ file, state: "directory-unavailable" as const }));
  return {
    agentDirectory: {
      pathHash: hashPath(agentDirectory),
      pathKind: pathKind(agentDirectory),
      source: options.agentDirectorySource,
      state: directory.state,
      containsSpaces: /\s/u.test(agentDirectory),
      containsNonAscii: containsNonAscii(agentDirectory),
      lengthClass: pathLengthClass(agentDirectory.length),
      currentEnvironmentMatchesAuthority: comparablePath(currentEnvironmentDirectory) === comparablePath(agentDirectory),
      ...(directory.errorClass ? { errorClass: directory.errorClass } : {})
    },
    files
  };
}

async function inspectDirectory(path: string): Promise<{
  state: PiConfigurationDiagnostics["agentDirectory"]["state"];
  errorClass?: DiagnosticFileErrorClass;
}> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return { state: "symlink" };
    return { state: metadata.isDirectory() ? "available" : "not-directory" };
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { state: "missing" }
      : { state: "unreadable", errorClass: classifyFileError(error) };
  }
}

async function inspectConfigurationFile(
  agentDirectory: string,
  file: PiConfigurationDiagnosticFileName
): Promise<PiConfigurationFileDiagnostic> {
  const path = join(agentDirectory, file);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { file, state: "missing" };
    return { file, state: "unreadable", errorClass: classifyFileError(error) };
  }
  const boundedMetadata = {
    sizeBytes: boundedNumber(metadata.size),
    modifiedAt: boundedNumber(metadata.mtimeMs)
  };
  if (metadata.isSymbolicLink()) return { file, state: "symlink", ...boundedMetadata };
  if (!metadata.isFile()) return { file, state: "not-file", ...boundedMetadata };
  if (metadata.size > MAX_DIAGNOSTIC_CONFIGURATION_BYTES) {
    return { file, state: "oversized", ...boundedMetadata };
  }
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    return { file, state: "unreadable", ...boundedMetadata, errorClass: classifyFileError(error) };
  }
  try {
    JSON.parse(content);
    return { file, state: "valid-json", ...boundedMetadata };
  } catch {
    return { file, state: "invalid-json", ...boundedMetadata };
  }
}

function comparablePath(path: string): string {
  const normalized = normalize(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function hashPath(path: string): string {
  return createHash("sha256").update(comparablePath(path)).digest("hex");
}

function pathKind(path: string): PiConfigurationDiagnostics["agentDirectory"]["pathKind"] {
  if (path.startsWith("\\\\")) return "unc";
  if (/^[A-Za-z]:[\\/]/u.test(path)) return "drive";
  return "posix";
}

function pathLengthClass(length: number): PiConfigurationDiagnostics["agentDirectory"]["lengthClass"] {
  if (length < 80) return "short";
  if (length < 160) return "medium";
  if (length < 240) return "long";
  return "extended";
}

function containsNonAscii(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return true;
  }
  return false;
}

function boundedNumber(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)));
}

function classifyFileError(error: unknown): DiagnosticFileErrorClass {
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM": return "access-denied";
    case "EIO": return "io";
    case "ENOTDIR": return "not-directory";
    case "ELOOP": return "path-loop";
    default: return "unknown";
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
