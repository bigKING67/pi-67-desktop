import type { AgentSessionRuntime, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import type { RuntimeIdentity } from "@pi67/domain";
import type { RuntimeDiagnostics } from "@pi67/protocol";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export function projectRuntimeIdentity(
  runtime: AgentSessionRuntime | undefined,
  sessionGeneration: number
): RuntimeIdentity {
  const session = runtime?.session;
  return {
    ...(session?.sessionId === undefined ? {} : { sessionId: session.sessionId }),
    ...(session?.sessionFile === undefined ? {} : { sessionPath: session.sessionFile }),
    sessionGeneration
  };
}

export function projectRuntimeDiagnostics(
  runtime: AgentSessionRuntime | undefined,
  extensions: LoadExtensionsResult | undefined,
  sdkVersion: string
): RuntimeDiagnostics {
  const session = runtime?.session;
  const cwd = session?.sessionManager.getCwd();
  const model = session?.model ? `${session.model.provider}/${session.model.id}` : undefined;
  return {
    application: "Pi-67 Desktop",
    piSdkVersion: sdkVersion,
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    ...(cwd === undefined ? {} : { cwd }),
    sessionConfigured: Boolean(session),
    sessionFileConfigured: Boolean(session?.sessionFile),
    ...(model === undefined ? {} : { model }),
    extensionCount: extensions?.extensions.length ?? 0,
    extensionErrors: extensions?.errors.map((error) => ({
      path: error.path,
      error: sanitizeRuntimeText(error.error)
    })) ?? []
  };
}
