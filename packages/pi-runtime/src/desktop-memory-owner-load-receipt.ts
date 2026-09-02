import { resolve } from "node:path";
import {
  memoryOwnerId,
  type DesktopMemoryOwnerPreflight
} from "./desktop-memory-owner-preflight.js";

export interface DesktopMemoryOwnerLoadReceipt {
  preflightState: DesktopMemoryOwnerPreflight["state"];
  startupCandidates: string[];
  loadedOwners: string[];
  blockedOwners: string[];
  observedAt: number;
}

const latestReceipts = new Map<string, DesktopMemoryOwnerLoadReceipt>();

export function recordDesktopMemoryOwnerLoadReceipt(
  agentDir: string,
  preflight: DesktopMemoryOwnerPreflight,
  loadedExtensionPaths: readonly string[]
): DesktopMemoryOwnerLoadReceipt {
  const receipt: DesktopMemoryOwnerLoadReceipt = {
    preflightState: preflight.state,
    startupCandidates: uniqueSorted(
      preflight.candidates.map((candidate) => candidate.displayName)
    ),
    loadedOwners: uniqueSorted(loadedExtensionPaths.flatMap((path) => {
      const id = memoryOwnerId(path);
      return id ? [id] : [];
    })),
    blockedOwners: [...preflight.blockedOwners],
    observedAt: Date.now()
  };
  latestReceipts.set(resolve(agentDir), receipt);
  return receipt;
}

export function readDesktopMemoryOwnerLoadReceipt(
  agentDir: string
): DesktopMemoryOwnerLoadReceipt | undefined {
  return latestReceipts.get(resolve(agentDir));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
