import { realpath, stat } from "node:fs/promises";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { isContained } from "./path-policy.js";

const DIRECTORY_READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILE_READ_TOOLS = new Set(["read", "grep"]);

interface ResourceReadGrant {
  kind: "directory" | "file";
  path: string;
}

export interface LoadedResourceReadAccess {
  allows(toolName: string, canonicalTarget: string): boolean;
}

export interface MutableLoadedResourceReadAccess extends LoadedResourceReadAccess {
  refresh(loader: ResourceLoader): Promise<void>;
}

const accessByLoader = new WeakMap<ResourceLoader, MutableLoadedResourceReadAccess>();

export function createLoadedResourceReadAccess(): MutableLoadedResourceReadAccess {
  let grants: readonly ResourceReadGrant[] = [];
  return {
    allows(toolName, canonicalTarget) {
      return grants.some((grant) => grantAllows(grant, toolName, canonicalTarget));
    },
    async refresh(loader) {
      grants = await collectResourceReadGrants(loader);
    }
  };
}

export function bindLoadedResourceReadAccess(
  loader: ResourceLoader,
  access: MutableLoadedResourceReadAccess
): void {
  accessByLoader.set(loader, access);
}

export async function refreshLoadedResourceReadAccess(loader: ResourceLoader): Promise<void> {
  await accessByLoader.get(loader)?.refresh(loader);
}

async function collectResourceReadGrants(loader: ResourceLoader): Promise<ResourceReadGrant[]> {
  const candidates: Array<{ kind: ResourceReadGrant["kind"]; path: string }> = [
    ...loader.getSkills().skills.map((skill) => ({ kind: "directory" as const, path: skill.baseDir })),
    ...loader.getPrompts().prompts.map((prompt) => ({ kind: "file" as const, path: prompt.filePath })),
    ...loader.getAgentsFiles().agentsFiles.map((file) => ({ kind: "file" as const, path: file.path })),
    ...loader.getExtensions().extensions
      .filter((extension) => !extension.hidden)
      .map((extension) => ({ kind: "file" as const, path: extension.resolvedPath }))
  ];
  const resolved = await Promise.all(candidates.map(resolveGrant));
  const unique = new Map<string, ResourceReadGrant>();
  for (const grant of resolved) {
    if (grant) unique.set(`${grant.kind}:${grant.path}`, grant);
  }
  return [...unique.values()];
}

async function resolveGrant(
  candidate: { kind: ResourceReadGrant["kind"]; path: string }
): Promise<ResourceReadGrant | undefined> {
  try {
    const path = await realpath(candidate.path);
    const metadata = await stat(path);
    if (candidate.kind === "directory" ? !metadata.isDirectory() : !metadata.isFile()) return undefined;
    return { kind: candidate.kind, path };
  } catch {
    return undefined;
  }
}

function grantAllows(grant: ResourceReadGrant, toolName: string, canonicalTarget: string): boolean {
  if (grant.kind === "directory") {
    return DIRECTORY_READ_TOOLS.has(toolName) && isContained(canonicalTarget, grant.path);
  }
  return FILE_READ_TOOLS.has(toolName) && canonicalTarget === grant.path;
}
