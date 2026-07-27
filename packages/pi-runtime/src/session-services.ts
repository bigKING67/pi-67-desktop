import {
  createAgentSessionServices,
  type AgentSessionServices
} from "@earendil-works/pi-coding-agent";
import { restoreRuntimeApiKeys } from "./model-control.js";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

interface DesktopSessionServicesOptions {
  cwd: string;
  agentDir: string;
  runtimeApiKeys: ReadonlyMap<string, string>;
  getSafety: () => SafetyPolicyState;
  requestApproval: DesktopApprovalRequester;
}

export async function createDesktopSessionServices(
  options: DesktopSessionServicesOptions
): Promise<AgentSessionServices> {
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    resourceLoaderOptions: {
      extensionFactories: [createDesktopSafetyExtension(options.getSafety, options.requestApproval)]
    },
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => options.getSafety().trust === "trusted"
    }
  });
  await restoreRuntimeApiKeys(services, options.runtimeApiKeys);
  return services;
}
