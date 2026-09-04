import type { OVConfig } from "./config.js";
import { tightenRuntimePrivacyFromModuleUrl } from "./config.js";
import { emitContextDiagnostic } from "./diagnostics.js";

export function createRuntimePrivacyGuard(
  config: OVConfig,
  moduleUrl: string,
  onDisabled: () => void,
): () => boolean {
  let reportedMode = config.privacyMode;
  return () => {
    tightenRuntimePrivacyFromModuleUrl(config, moduleUrl);
    if (reportedMode !== config.privacyMode) {
      reportedMode = config.privacyMode;
      emitContextDiagnostic({
        kind: config.enabled ? "context.ownerLocked" : "context.memoryDisabled",
        privacyMode: config.privacyMode,
        state: config.enabled ? "privacy-tightened" : "disabled",
        reason: config.enabled ? "runtime-privacy-tightened" : "runtime-privacy-disabled",
      });
    }
    if (!config.enabled) onDisabled();
    return config.enabled;
  };
}
