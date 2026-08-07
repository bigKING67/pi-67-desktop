import { createHash } from "node:crypto";
import type { AgentSessionRuntime, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import type { RuntimeIdentity } from "@pi67/domain";
import type { RuntimeDiagnostics } from "@pi67/protocol";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export function projectRuntimeIdentity(
  runtime: AgentSessionRuntime | undefined,
  sessionGeneration: number,
  sessionFileIdentity: string | undefined
): RuntimeIdentity {
  const session = runtime?.session;
  return {
    ...(session?.sessionId === undefined ? {} : { sessionId: session.sessionId }),
    ...(sessionFileIdentity === undefined ? {} : { sessionFileIdentity }),
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
    generatedAt: Date.now(),
    application: "π",
    piSdkVersion: sdkVersion,
    platform: process.platform,
    architecture: process.arch,
    node: process.versions.node,
    ...(cwd === undefined ? {} : {
      workspace: {
        pathHash: hashDiagnosticValue(cwd),
        pathKind: diagnosticPathKind(cwd)
      }
    }),
    sessionConfigured: Boolean(session),
    sessionFileConfigured: Boolean(session?.sessionFile),
    ...(model === undefined ? {} : { model }),
    extensionCount: extensions?.extensions.length ?? 0,
    extensionErrors: extensions?.errors.map((error) => ({
      sourceHash: hashDiagnosticValue(error.path),
      errorClass: diagnosticErrorClass(sanitizeRuntimeText(error.error))
    })) ?? []
  };
}

function hashDiagnosticValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function diagnosticPathKind(value: string): "drive" | "unc" | "posix" {
  if (/^(?:\\\\|\/\/)/u.test(value)) return "unc";
  if (/^[A-Za-z]:[\\/]/u.test(value)) return "drive";
  return "posix";
}

function diagnosticErrorClass(value: string): string {
  const code = value.match(/\b(?:E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+)\b/u)?.[0];
  return code && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : "EXTENSION_LOAD_FAILED";
}
