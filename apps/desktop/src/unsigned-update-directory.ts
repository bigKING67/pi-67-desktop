import { lstat, mkdir } from "node:fs/promises";

export async function ensureUnsignedUpdateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The Pi-67 update directory is not a regular directory.");
  }
}
