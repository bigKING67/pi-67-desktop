import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { onTestFinished } from "vitest";
import sharp from "sharp";
import { sha256 } from "../content-store.js";
import type { ImageDocument, SceneObject } from "../document.js";
import type { JsonRecord } from "../document.js";

export async function tempDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), prefix));
  onTestFinished(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  return directory;
}

// Flat digest map of every file under root, used to prove a failed or dry-run
// operation left the project byte-identical.
export async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else result[path.relative(root, file)] = sha256(await fs.readFile(file));
    }
  }
  await walk(root); return result;
}

export async function pixels(file: string): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> {
  const { data, info } = await sharp(await fs.readFile(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info: { width: info.width, height: info.height, channels: info.channels } };
}

export const batch = (base_revision: number, operations: JsonRecord[], author: "agent" | "human" = "agent"): JsonRecord =>
  ({ base_revision, author, summary: "Test image edit", operations });
export const update = (id: string, patch: JsonRecord): JsonRecord => ({ type: "update_object", id, patch });
export const objectById = (doc: ImageDocument, id: string): SceneObject => {
  const object = doc.objects.find((item) => item.id === id);
  if (!object) throw new Error(`Missing test object ${id}`);
  return object;
};
export const readJson = async (file: string): Promise<JsonRecord> => JSON.parse(await fs.readFile(file, "utf8")) as JsonRecord;
