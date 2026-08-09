import { lstat, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export type RetiredTeamMcpTokenCleanupStatus = "missing" | "removed" | "preserved-unsafe" | "failed";

export async function removeRetiredTeamMcpToken(userData: string): Promise<RetiredTeamMcpTokenCleanupStatus> {
  const directory = join(resolve(userData), "team-mcp");
  const tokenPath = join(directory, "tavily-bridge.token");
  try {
    const directoryMetadata = await lstat(directory);
    if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) return "preserved-unsafe";
    const tokenMetadata = await lstat(tokenPath);
    if (tokenMetadata.isSymbolicLink() || !tokenMetadata.isFile()) return "preserved-unsafe";
    await rm(tokenPath, { force: true });
    await rmdir(directory).catch(() => undefined);
    return "removed";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
    return "failed";
  }
}
