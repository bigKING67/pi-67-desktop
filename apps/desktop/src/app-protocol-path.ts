import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;
const ENCODED_BYTE = /%[0-9a-f]{2}/iu;

export function resolveApplicationAssetPath(rendererDirectory: string, requestUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "app:"
    || url.hostname !== "pi67"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || url.search !== ""
    || url.hash !== ""
  ) return undefined;

  const rawPath = rawApplicationPath(requestUrl);
  if (rawPath === undefined || rawPath.includes("\\") || ENCODED_SEPARATOR.test(rawPath)) return undefined;
  let requestedPath: string;
  try {
    requestedPath = decodeURIComponent(rawPath === "" || rawPath === "/" ? "/index.html" : rawPath);
  } catch {
    return undefined;
  }
  if (
    !requestedPath.startsWith("/")
    || requestedPath.startsWith("//")
    || containsControlCharacter(requestedPath)
    || ENCODED_BYTE.test(requestedPath)
  ) return undefined;
  const segments = requestedPath.slice(1).split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes(":"))
  ) return undefined;

  const root = resolve(rendererDirectory);
  const filePath = resolve(root, ...segments);
  const escapePath = relative(root, filePath);
  if (escapePath === ".." || escapePath.startsWith(`..${sep}`) || isAbsolute(escapePath)) return undefined;
  return filePath;
}

export async function resolveApplicationAssetFilePath(
  rendererDirectory: string,
  requestUrl: string
): Promise<string | undefined> {
  const lexicalPath = resolveApplicationAssetPath(rendererDirectory, requestUrl);
  if (!lexicalPath) return undefined;
  try {
    const [physicalRoot, metadata, physicalPath] = await Promise.all([
      realpath(rendererDirectory),
      lstat(lexicalPath),
      realpath(lexicalPath)
    ]);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return undefined;
    return isWithinRoot(physicalRoot, physicalPath) ? physicalPath : undefined;
  } catch {
    return undefined;
  }
}

function rawApplicationPath(requestUrl: string): string | undefined {
  const prefix = "app://";
  if (!requestUrl.startsWith(prefix)) return undefined;
  const authorityStart = prefix.length;
  const pathStart = requestUrl.indexOf("/", authorityStart);
  const queryStart = requestUrl.indexOf("?", authorityStart);
  const fragmentStart = requestUrl.indexOf("#", authorityStart);
  const authorityEnd = minimumPositive(pathStart, queryStart, fragmentStart, requestUrl.length);
  if (requestUrl.slice(authorityStart, authorityEnd) !== "pi67") return undefined;
  if (pathStart < 0 || pathStart > authorityEnd) return "";
  const pathEnd = minimumPositive(queryStart, fragmentStart, requestUrl.length);
  return requestUrl.slice(pathStart, pathEnd);
}

function minimumPositive(...values: number[]): number {
  return Math.min(...values.filter((value) => value >= 0));
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const escapePath = relative(root, candidate);
  return escapePath !== ".." && !escapePath.startsWith(`..${sep}`) && !isAbsolute(escapePath);
}
