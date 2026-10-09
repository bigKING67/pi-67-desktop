import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { IMAGE_LIBRARY_MARKER, IMAGE_WORK_DIRECTORY, imagePreviewRelativePath, imageProjectRelativePath, isImageId, type ImageProjectOwnership } from "@pi67/domain";

/**
 * Projects resolve from the session's Workspace and a project id only; tools
 * never accept a project path, so the Agent cannot point the engine at an
 * arbitrary directory through these tools.
 */
export function projectRoot(cwd: string, projectId: string): string {
  if (!isImageId(projectId)) throw new Error("Invalid image project id");
  return path.join(cwd, ...imageProjectRelativePath(workspaceOwnership(cwd), projectId));
}

/** The creative library carries a marker at its root; every other Workspace is ordinary. */
export function workspaceOwnership(cwd: string): ImageProjectOwnership {
  return existsSync(path.join(cwd, IMAGE_LIBRARY_MARKER)) ? "library" : "workspace";
}

/** The folder that holds a Workspace's image projects. */
export function projectsDirectory(cwd: string): string {
  return workspaceOwnership(cwd) === "library" ? cwd : path.join(cwd, ".newmoney", "images");
}

/** Content-addressed previews the renderer reads through Main by digest. */
export function previewCachePath(cwd: string, projectId: string, pngSha256: string): string {
  return path.join(cwd, ...imagePreviewRelativePath(projectId, pngSha256));
}

/** A fresh directory for one render or job input, outside every project. */
export async function workDirectory(cwd: string, projectId: string, kind: "preview" | "export" | "job" | "compare" | "import"): Promise<string> {
  if (!isImageId(projectId)) throw new Error("Invalid image project id");
  const parent = path.join(cwd, ...IMAGE_WORK_DIRECTORY, projectId);
  await fs.mkdir(parent, { recursive: true });
  return path.join(parent, `${kind}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`);
}

/** Creates the parent folder a new project needs (`.newmoney/images/` inside an ordinary Workspace). */
export async function ensureProjectParent(root: string): Promise<void> {
  await fs.mkdir(path.dirname(root), { recursive: true });
}
