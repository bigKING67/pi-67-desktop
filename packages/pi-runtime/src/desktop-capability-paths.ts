import { isAbsolute, relative, resolve, sep } from "node:path";

export function projectedCapabilityPackagePaths(environment: NodeJS.ProcessEnv): string[] {
  const roots = desktopCapabilityRoots(environment);
  const serialized = nonEmpty(environment.PI67_CAPABILITY_PACKAGE_PATHS);
  if (roots.length === 0 || !serialized) return [];
  let candidates: unknown;
  try {
    candidates = JSON.parse(serialized) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((candidate): candidate is string => (
    typeof candidate === "string"
    && roots.some((root) => isContainedAbsolutePath(candidate, root))
  ));
}

export function desktopCapabilityRoots(environment: NodeJS.ProcessEnv): string[] {
  return [...new Set([
    nonEmpty(environment.PI67_BUNDLED_CAPABILITIES_ROOT),
    nonEmpty(environment.PI67_MANAGED_CAPABILITIES_ROOT)
  ].filter((root): root is string => root !== undefined && isAbsolute(root)).map((root) => resolve(root)))];
}

export function isSameOrContainedAbsolutePath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  return isSameAbsolutePath(candidate, root) || isContainedAbsolutePath(candidate, root);
}

export function isSameAbsolutePath(candidate: string, expected: string): boolean {
  if (!isAbsolute(candidate) || !isAbsolute(expected)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  return normalize(candidate) === normalize(expected);
}

export function isContainedAbsolutePath(candidate: string, root: string): boolean {
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

export function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
