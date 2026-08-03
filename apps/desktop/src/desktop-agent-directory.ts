import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveDesktopAgentDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}
