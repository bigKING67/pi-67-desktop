import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

const MAX_CONCURRENT_SESSION_DIRECTORIES = 4;

export async function listAgentSessions(agentDir: string): Promise<SessionInfo[]> {
  const sessionsRoot = join(agentDir, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(sessionsRoot, entry.name));
  const sessions: SessionInfo[] = [];
  const workerCount = Math.min(MAX_CONCURRENT_SESSION_DIRECTORIES, directories.length);
  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => listSessionLane(directories, index, workerCount, sessions))
  );
  return sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

async function listSessionLane(
  directories: string[],
  index: number,
  stride: number,
  sessions: SessionInfo[]
): Promise<void> {
  const directory = directories[index];
  if (!directory) return;
  sessions.push(...await SessionManager.listAll(directory));
  await listSessionLane(directories, index + stride, stride, sessions);
}
