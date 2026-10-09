import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { IMAGE_LIBRARY_MARKER, IMAGE_WORK_DIRECTORY, imageProjectRelativePath, isImageId } from "@pi67/domain";

/**
 * Projects resolve from the session's Workspace and a project id only; tools
 * never accept a project path, so the Agent cannot point the engine at an
 * arbitrary directory through these tools.
 */
export function projectRoot(cwd: string, projectId: string): string {
  if (!isImageId(projectId)) throw new Error("Invalid image project id");
  const ownership = existsSync(path.join(cwd, IMAGE_LIBRARY_MARKER)) ? "library" : "workspace";
  return path.join(cwd, ...imageProjectRelativePath(ownership, projectId));
}

/** A fresh directory for one render or job input, outside every project. */
export async function workDirectory(cwd: string, projectId: string, kind: "preview" | "export" | "job" | "compare"): Promise<string> {
  if (!isImageId(projectId)) throw new Error("Invalid image project id");
  const parent = path.join(cwd, ...IMAGE_WORK_DIRECTORY, projectId);
  await fs.mkdir(parent, { recursive: true });
  return path.join(parent, `${kind}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`);
}

/** Creates the parent folder a new project needs (`.newmoney/images/` inside an ordinary Workspace). */
export async function ensureProjectParent(root: string): Promise<void> {
  await fs.mkdir(path.dirname(root), { recursive: true });
}
