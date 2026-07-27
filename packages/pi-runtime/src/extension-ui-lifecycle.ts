import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export function createSessionExtensionUiBridge(
  emit: (event: AgentEvent) => void,
  getSessionId: () => string | undefined
): DesktopExtensionUiBridge {
  return new DesktopExtensionUiBridge(emit, () => {
    const sessionId = getSessionId();
    return sessionId === undefined ? {} : { sessionId };
  });
}

export async function bindSessionExtensionUi(
  session: AgentSession,
  bridge: DesktopExtensionUiBridge,
  emit: (event: AgentEvent) => void
): Promise<void> {
  await session.bindExtensions({
    uiContext: bridge.context,
    mode: "rpc",
    onError: (error) => emit({
      type: "extension.compatibilityChanged",
      payload: {
        extensionPath: error.extensionPath,
        status: "unsupported",
        detail: sanitizeRuntimeText(error.error)
      }
    })
  });
}
