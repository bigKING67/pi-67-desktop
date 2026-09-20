import type {
  AgentRuntime,
  PiSdkRuntimeOptions
} from "@pi67/pi-runtime";
import { createMessageId } from "@pi67/protocol";
import type { HostConnectionIdentity } from "./connection-context.js";

/** Initial Host identity from the explicit handoff or owned process environment.
 * The server caches this once; attaching another Renderer never replaces it. */
export function initialHostIdentity(options: Partial<HostConnectionIdentity>): HostConnectionIdentity {
  return {
    ...(options.appInstanceId === undefined ? {} : { appInstanceId: options.appInstanceId }),
    hostInstanceId: options.hostInstanceId ?? process.env.PI67_HOST_INSTANCE_ID ?? createMessageId("host"),
    hostEpoch: options.hostEpoch ?? parseHostEpoch(process.env.PI67_HOST_EPOCH)
  };
}

export async function defaultRuntimeLoader(options?: PiSdkRuntimeOptions): Promise<AgentRuntime> {
  const { PiSdkRuntime } = await import("@pi67/pi-runtime");
  return new PiSdkRuntime(options);
}

function parseHostEpoch(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 1;
}
