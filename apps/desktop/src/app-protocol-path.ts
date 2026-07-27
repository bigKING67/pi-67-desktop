import { join, normalize, relative, sep } from "node:path";

export function resolveApplicationAssetPath(rendererDirectory: string, requestUrl: string): string | undefined {
  const url = new URL(requestUrl);
  if (url.hostname !== "pi67") return undefined;

  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = normalize(join(rendererDirectory, requestedPath.replace(/^[/\\]+/u, "")));
  const escapePath = relative(rendererDirectory, filePath);
  if (escapePath.startsWith("..") || escapePath.includes(`..${sep}`)) return undefined;
  return filePath;
}
