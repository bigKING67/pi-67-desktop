import type {
  AgentRuntime,
  PiSdkRuntimeOptions
} from "@pi67/pi-runtime";

export async function defaultRuntimeLoader(options?: PiSdkRuntimeOptions): Promise<AgentRuntime> {
  const { PiSdkRuntime } = await import("@pi67/pi-runtime");
  return new PiSdkRuntime(options);
}

export function parseHostEpoch(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 1;
}
