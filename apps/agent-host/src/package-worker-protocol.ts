import type { ExtensionPackageScope } from "@pi67/domain";
import type { ProtocolErrorCode } from "@pi67/protocol";

export type PackageWorkerAction =
  | "check-updates"
  | "install"
  | "update"
  | "uninstall";

export interface PackageWorkerRequest {
  type: "package-worker-request";
  requestId: string;
  action: PackageWorkerAction;
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  networkSettingsPath?: string;
  source?: string;
  scope?: ExtensionPackageScope;
}

export type PackageWorkerResponse =
  | {
      type: "package-worker-response";
      requestId: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "package-worker-response";
      requestId: string;
      ok: false;
      error: {
        code: ProtocolErrorCode;
        message: string;
        recoverable: boolean;
        details?: Record<string, string | number | boolean>;
      };
    };

export function isPackageWorkerResponse(value: unknown, requestId: string): value is PackageWorkerResponse {
  if (!isRecord(value) || value.type !== "package-worker-response" || value.requestId !== requestId) return false;
  if (value.ok === true) return Object.hasOwn(value, "result");
  if (value.ok !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === "string"
    && typeof value.error.message === "string"
    && typeof value.error.recoverable === "boolean";
}

export function isPackageWorkerRequest(value: unknown): value is PackageWorkerRequest {
  if (!isRecord(value) || value.type !== "package-worker-request") return false;
  if (
    typeof value.requestId !== "string"
    || value.requestId.length === 0
    || value.requestId.length > 200
    || typeof value.cwd !== "string"
    || value.cwd.length === 0
    || value.cwd.length > 4_096
    || typeof value.agentDir !== "string"
    || value.agentDir.length === 0
    || value.agentDir.length > 4_096
    || typeof value.projectTrusted !== "boolean"
  ) return false;
  if (!isPackageWorkerAction(value.action)) return false;
  if (value.networkSettingsPath !== undefined && (
    typeof value.networkSettingsPath !== "string" || value.networkSettingsPath.length > 4_096
  )) return false;
  if (value.source !== undefined && (
    typeof value.source !== "string" || value.source.length === 0 || value.source.length > 4_096
  )) return false;
  if (value.scope !== undefined && value.scope !== "global" && value.scope !== "project") return false;
  return value.action === "check-updates"
    ? value.source === undefined && value.scope === undefined
    : typeof value.source === "string" && (value.scope === "global" || value.scope === "project");
}

function isPackageWorkerAction(value: unknown): value is PackageWorkerAction {
  return value === "check-updates" || value === "install" || value === "update" || value === "uninstall";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
