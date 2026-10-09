import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { IMAGE_PROJECT_LIMITS, imagePreviewRelativePath, isImageId } from "@pi67/protocol";
import type { WorkbenchStateStore } from "./workbench-state.js";
import { refreshPersistedWorkspaceDescriptor } from "./workspace-identity.js";

// `app://pi67/image/<workspaceId>/<projectId>/<sha256>.png` serves one
// content-addressed preview that Agent Host rendered (ADR 0010 decision 10).
// The renderer names a preview only by Workspace, project and digest; Main
// resolves the trusted Workspace root itself and re-hashes the bytes, so a
// replaced or symlinked file is never served under a digest it does not have.
const PREFIX = "/image/";
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const PREVIEW_FILE = /^([a-f0-9]{64})\.png$/u;
const MAX_PREVIEW_BYTES = IMAGE_PROJECT_LIMITS.pixels * 5;

export interface ImagePreviewReference { workspaceId: string; projectId: string; pngSha256: string }
export type TrustedWorkspaceRoot = (workspaceId: string) => Promise<string | undefined>;

/** Whether the URL addresses the preview route at all (other app:// paths are renderer assets). */
export function isImagePreviewUrl(requestUrl: string): boolean {
  try { return new URL(requestUrl).pathname.startsWith(PREFIX); } catch { return false; }
}

export function parseImagePreviewUrl(requestUrl: string): ImagePreviewReference | undefined {
  let url: URL;
  try { url = new URL(requestUrl); } catch { return undefined; }
  if (url.protocol !== "app:" || url.hostname !== "pi67" || url.username || url.password || url.port || url.search || url.hash) return undefined;
  const segments = url.pathname.slice(PREFIX.length).split("/");
  if (!url.pathname.startsWith(PREFIX) || segments.length !== 3) return undefined;
  const [workspaceId = "", projectId = "", file = ""] = segments;
  const match = PREVIEW_FILE.exec(file);
  if (!WORKSPACE_ID.test(workspaceId) || !isImageId(projectId) || !match?.[1]) return undefined;
  return { workspaceId, projectId, pngSha256: match[1] };
}

const notFound = (): Response => new Response("Not found", { status: 404 });

export async function readImagePreview(requestUrl: string, workspaceRoot: TrustedWorkspaceRoot): Promise<Response> {
  const reference = parseImagePreviewUrl(requestUrl);
  if (!reference) return notFound();
  try {
    const root = await workspaceRoot(reference.workspaceId);
    if (!root) return notFound();
    const candidate = resolve(root, ...imagePreviewRelativePath(reference.projectId, reference.pngSha256));
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_PREVIEW_BYTES) return notFound();
    const [physicalRoot, physicalPath] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!contained(physicalRoot, physicalPath)) return notFound();
    const bytes = await readFile(physicalPath);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.pngSha256) return notFound();
    return new Response(new Uint8Array(bytes), { status: 200, headers: {
      "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"
    } });
  } catch {
    return notFound();
  }
}

/** The canonical root of a persisted Workspace that is still available and trusted. */
export function trustedWorkspaceRoot(workbenchState: () => Pick<WorkbenchStateStore, "load"> | undefined): TrustedWorkspaceRoot {
  return async (workspaceId) => {
    const store = workbenchState();
    if (!store) return undefined;
    const persisted = (await store.load()).state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!persisted) return undefined;
    const workspace = await refreshPersistedWorkspaceDescriptor(persisted);
    return workspace.availability === "available" && workspace.trust === "trusted" ? workspace.identity.canonicalPath : undefined;
  };
}

function contained(root: string, candidate: string): boolean {
  const normalize = (path: string): string => process.platform === "win32" ? path.toLowerCase() : path;
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
