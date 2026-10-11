import * as fs from "node:fs/promises";
import type { AgentEvent, ImageEventPayloads } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

// Small pieces the image Host's command handlers share.

export type ImageEngine = typeof import("@pi67/image-engine");
export const event = <T extends keyof ImageEventPayloads>(type: T, payload: ImageEventPayloads[T]): AgentEvent => ({ type, payload }) as AgentEvent;
export const PHOTO_EXTENSIONS: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const key = (workspaceId: string, projectId: string): string => `${workspaceId}\u0000${projectId}`;


/** `base`, or `base-2`, `base-3`… when a project of that name already exists. */
export async function freeProjectId(engine: ImageEngine, cwd: string, base: string, exhausted: string): Promise<string> {
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? base : `${base}-${index}`;
    try { await fs.lstat(engine.projectRoot(cwd, candidate)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate; throw error; }
  }
  throw new HostCommandError("INVALID_PAYLOAD", exhausted, false);
}

