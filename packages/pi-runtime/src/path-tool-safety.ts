import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  MAX_APPROVAL_CWD_BYTES,
  type RiskCategory,
  type ToolAutoAuthorizationReason
} from "@pi67/domain";
import type { LoadedResourceReadAccess } from "./loaded-resource-read-access.js";
import { canonicalizePotentialPath, isContained } from "./path-policy.js";

const WRITE_TOOLS = new Set(["write", "edit"]);
const USER_CREDENTIAL_ROOTS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".config/gh",
  "Library/Keychains"
] as const;
const USER_CONFIGURATION_ROOTS = [
  ".codex",
  ".claude",
  "Library/LaunchAgents"
] as const;
const USER_SENSITIVE_FILES = [
  ".gitconfig",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".zshrc",
  ".bashrc",
  ".bash_profile",
  ".profile"
] as const;

export interface PathToolSafetyIntent {
  toolName: string;
  category: RiskCategory;
  target: string;
  targetKind: "path";
  sourceLabel: string;
  autoAuthorizationReason?: ToolAutoAuthorizationReason;
  taskPathGrant?: readonly string[];
}

export async function classifyPathToolIntent(
  toolName: string,
  sourceLabel: string,
  capabilityName: string,
  rawPath: string,
  workspace: string,
  loadedResourceReadAccess?: LoadedResourceReadAccess,
  taskTrustedRoots: readonly string[] = [],
  allowTaskPathGrant = true
): Promise<PathToolSafetyIntent> {
  const expandedPath = rawPath === "~"
    ? homedir()
    : rawPath.startsWith("~/")
      ? resolve(homedir(), rawPath.slice(2))
      : rawPath;
  const canonical = await canonicalizePotentialPath(expandedPath, workspace);
  const canonicalWorkspace = await realpath(resolve(workspace));
  const contained = isContained(canonical, canonicalWorkspace);
  const writeTool = WRITE_TOOLS.has(capabilityName);
  const sensitiveWriteCategory = writeTool ? classifySensitiveWriteTarget(canonical) : undefined;
  const taskRootContained = allowTaskPathGrant
    && !contained
    && taskTrustedRoots.some((root) => isContained(canonical, root));
  const category: RiskCategory = sensitiveWriteCategory ?? (contained || taskRootContained
    ? writeTool ? "workspace-write" : "workspace-read"
    : loadedResourceReadAccess?.allows(capabilityName, canonical)
      ? "resource-read"
      : "external-path");
  const routineExternalWrite = writeTool
    && !contained
    && !taskRootContained
    && sensitiveWriteCategory === undefined;
  return {
    toolName,
    category,
    target: canonical,
    targetKind: "path",
    sourceLabel,
    ...(taskRootContained
      ? { autoAuthorizationReason: "task-trusted-root" as const }
      : routineExternalWrite
        ? { autoAuthorizationReason: "routine-write" as const }
        : {}),
    ...(allowTaskPathGrant
      && !writeTool
      && !contained
      && !taskRootContained
      && category === "external-path"
      && Buffer.byteLength(canonical, "utf8") <= MAX_APPROVAL_CWD_BYTES
      ? { taskPathGrant: [canonical] }
      : {})
  };
}

function classifySensitiveWriteTarget(canonical: string): RiskCategory | undefined {
  const home = resolve(homedir());
  if (USER_CREDENTIAL_ROOTS.some((path) => isContained(canonical, resolve(home, path)))) {
    return "credential-or-auth";
  }
  if (
    USER_CONFIGURATION_ROOTS.some((path) => isContained(canonical, resolve(home, path)))
    || USER_SENSITIVE_FILES.some((path) => canonical === resolve(home, path))
  ) return "system-configuration";

  const systemRoots = process.platform === "win32"
    ? [
        process.env.SystemRoot,
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.ProgramData
      ].filter((path): path is string => typeof path === "string" && path.length > 0)
    : [
        "/System",
        "/Library",
        "/Applications",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/private/etc",
        "/var/db",
        "/private/var/db",
        "/var/root",
        "/private/var/root",
        "/var/run",
        "/private/var/run",
        "/opt"
      ];
  return systemRoots.some((root) => isContained(canonical, resolve(root)))
    ? "system-configuration"
    : undefined;
}
