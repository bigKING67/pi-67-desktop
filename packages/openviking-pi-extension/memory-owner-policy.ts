import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const CONTEXT_OWNER_ID = "pi67-openviking";

const CONFLICTING_IDS = new Set([
  "pi-observational-memory",
  "pi-hy-memory",
]);

export interface MemoryOwnerConflict {
  owner: string;
  conflicts: string[];
  reason: "multiple-context-owners" | "duplicate-openviking-owner";
}

export function detectMemoryOwnerConflict(agentDir: string): MemoryOwnerConflict | null {
  const configured = configuredPackageIds(join(agentDir, "settings.json"));
  const installed = installedExtensionIds(join(agentDir, "extensions"));
  const active = new Set([...configured, ...installed]);
  const conflicts = [...active].filter((id) => CONFLICTING_IDS.has(id)).sort();
  if (conflicts.length > 0) {
    return { owner: CONTEXT_OWNER_ID, conflicts, reason: "multiple-context-owners" };
  }

  const openVikingOwners = [...active].filter((id) => /openviking/i.test(id));
  const distinct = new Set(openVikingOwners.map((id) => id.toLowerCase()));
  if (distinct.size > 1) {
    return {
      owner: CONTEXT_OWNER_ID,
      conflicts: [...distinct].filter((id) => id !== CONTEXT_OWNER_ID).sort(),
      reason: "duplicate-openviking-owner",
    };
  }
  return null;
}

function configuredPackageIds(settingsPath: string): string[] {
  try {
    if (!existsSync(settingsPath)) return [];
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    const packages = Array.isArray(parsed?.packages) ? parsed.packages : [];
    return packages.map(packageSource).filter(Boolean).map(packageId);
  } catch {
    return [];
  }
}

function installedExtensionIds(root: string): string[] {
  try {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function packageSource(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "source" in value) {
    return typeof (value as { source?: unknown }).source === "string"
      ? (value as { source: string }).source
      : "";
  }
  return "";
}

function packageId(source: string): string {
  const normalized = source.replace(/^(npm|git):/, "").replace(/\\/g, "/");
  const tail = normalized.split("/").filter(Boolean).pop() ?? normalized;
  return tail.replace(/\.git(?:@.*)?$/, "").replace(/@\d.*$/, "");
}
