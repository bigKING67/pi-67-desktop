import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  inspectGlobalDesktopMemoryOwners,
  readDesktopMemoryOwnerLoadReceipt,
  type DesktopMemoryOwnerLoadReceipt
} from "@pi67/pi-runtime";

const MEMORY_OWNER_PATTERNS = [
  /(?:^|[-_])observational-memory(?:$|[-_])/i,
  /(?:^|[-_])hy-memory(?:$|[-_])/i,
  /openviking/i
];

export interface MemoryOwnerRuntimeInspection {
  installedOwners: string[];
  enabledOwners: string[];
  retiredOwners: string[];
  blockedOwners: string[];
  state: "not-configured" | "single-owner" | "conflict";
  selectedOwner?: string;
  loadReceipt?: DesktopMemoryOwnerLoadReceipt;
}

export interface MemoryOwnerDiagnosticCheck {
  id: "memory-owner-installation" | "memory-owner-preflight" | "memory-owner-load-receipt";
  status: "pass" | "warn" | "fail";
  detail: string;
}

export async function inspectMemoryOwnerRuntime(
  agentDir: string
): Promise<MemoryOwnerRuntimeInspection> {
  const extensionRoot = join(agentDir, "extensions");
  const entries = await readdir(extensionRoot, { withFileTypes: true }).catch(() => []);
  const installedOwners = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => MEMORY_OWNER_PATTERNS.some((pattern) => pattern.test(name)))
    .sort((left, right) => left.localeCompare(right));
  const preflight = inspectGlobalDesktopMemoryOwners(agentDir);
  const loadReceipt = readDesktopMemoryOwnerLoadReceipt(agentDir);
  const enabledOwners = [...new Set(
    preflight.candidates.map((candidate) => candidate.displayName)
  )].sort((left, right) => left.localeCompare(right));
  return {
    installedOwners,
    enabledOwners,
    retiredOwners: preflight.retiredOwners,
    blockedOwners: preflight.blockedOwners,
    state: preflight.state,
    ...(loadReceipt === undefined ? {} : { loadReceipt }),
    ...(preflight.selectedOwner === undefined
      ? {}
      : { selectedOwner: preflight.selectedOwner })
  };
}

export async function detectMemoryOwnerConflicts(agentDir: string): Promise<string[]> {
  const inspection = await inspectMemoryOwnerRuntime(agentDir);
  return inspection.state === "conflict" ? inspection.blockedOwners : [];
}

export function memoryOwnerConflictDetail(
  inspection: MemoryOwnerRuntimeInspection
): string | undefined {
  if (inspection.state !== "conflict") return undefined;
  return `New-Session startup gate blocked all competing Memory owners (${inspection.blockedOwners.join(", ")}). Pi default Compaction remains available; no memory data was deleted.`;
}

export function memoryOwnerDiagnosticChecks(
  inspection: MemoryOwnerRuntimeInspection
): MemoryOwnerDiagnosticCheck[] {
  const installed = inspection.installedOwners.length === 0
    ? "none"
    : inspection.installedOwners.join(", ");
  const enabled = inspection.enabledOwners.length === 0
    ? "none"
    : inspection.enabledOwners.join(", ");
  const retiredSuffix = inspection.retiredOwners.length === 0
    ? ""
    : ` Retired owners were excluded before loading: ${inspection.retiredOwners.join(", ")}.`;
  const preflightDetail = inspection.state === "conflict"
    ? `Startup gate will load none of the conflicting Memory owners: ${inspection.blockedOwners.join(", ")}.`
    : inspection.selectedOwner === undefined
      ? `No third-party Memory owner will load; Pi default Compaction remains available.${retiredSuffix}`
      : `Exactly one Memory owner is eligible for a new Session: ${inspection.selectedOwner}.${retiredSuffix}`;
  const receipt = inspection.loadReceipt;
  const retiredOwners = new Set(inspection.retiredOwners);
  const receiptValid = receipt !== undefined && (
    receipt.preflightState === "conflict"
      ? receipt.loadedOwners.length === 0
      : receipt.loadedOwners.length <= 1
        && !receipt.loadedOwners.some((owner) => retiredOwners.has(owner))
  );
  const receiptDetail = receipt === undefined
    ? "No Session ResourceLoader receipt has been observed since this Agent Host started."
    : `Latest Session ResourceLoader receipt loaded ${receipt.loadedOwners.length === 0 ? "no Memory owner" : receipt.loadedOwners.join(", ")} at ${new Date(receipt.observedAt).toISOString()}.`;
  return [
    {
      id: "memory-owner-installation",
      status: "pass",
      detail: `Installed owner directories: ${installed}. Discovered owner candidates: ${enabled}.`
    },
    {
      id: "memory-owner-preflight",
      status: inspection.state === "conflict" ? "fail" : "pass",
      detail: preflightDetail
    },
    {
      id: "memory-owner-load-receipt",
      status: receipt === undefined ? "warn" : receiptValid ? "pass" : "fail",
      detail: receiptDetail
    }
  ];
}
