import { isAbsolute, relative, resolve, sep } from "node:path";

export function isContainedManagedCapabilityPath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}
