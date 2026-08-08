export function attachmentCandidate(overrides: {
  name: string;
  byteLength: number;
  path?: string;
  data?: ArrayBuffer;
  mimeType?: string;
  lastModified?: number;
}) {
  return {
    name: overrides.name,
    mimeType: overrides.mimeType ?? "application/octet-stream",
    byteLength: overrides.byteLength,
    lastModified: overrides.lastModified ?? 0,
    ...(overrides.path === undefined ? {} : { path: overrides.path }),
    ...(overrides.data === undefined ? {} : { data: overrides.data })
  };
}

export function pngBuffer(byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  return bytes.buffer;
}

export function bufferCandidate(name: string, bytes: number[], mimeType = "") {
  const data = Uint8Array.from(bytes).buffer;
  return attachmentCandidate({ name, mimeType, byteLength: data.byteLength, data });
}

export async function draftDirectories(root: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
