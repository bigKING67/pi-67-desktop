import type { AgentCommandType } from "./agent-messages.js";

export const EXTENSION_PACKAGE_WORKER_TIMEOUT_MS = 5 * 60_000;
// Keep the port alive long enough for Agent Host to return the worker's bounded timeout error.
export const EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS = EXTENSION_PACKAGE_WORKER_TIMEOUT_MS + 60_000;

export function isWorkerBackedExtensionPackageCommand(type: AgentCommandType): boolean {
  return type === "extension.package.checkUpdates"
    || type === "extension.package.install"
    || type === "extension.package.update"
    || type === "extension.package.uninstall"
    || type === "skill.pack.checkUpdates"
    || type === "skill.pack.update"
    || type === "skill.pack.restore";
}
