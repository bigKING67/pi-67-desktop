import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

export async function resolveLarkCli(options: {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  shellPath: string | undefined;
  runProcess: SkillPackProcessRunner;
}): Promise<string | undefined> {
  const privateToolchainRoot = resolveOptionalPath(options.environment.PI67_TOOLCHAIN_ROOT);
  const isUserManagedExecutable = (candidate: string): boolean => (
    !privateToolchainRoot || !isContainedAbsolutePath(candidate, privateToolchainRoot)
  );
  const configured = options.environment.PI67_LARK_CLI_PATH;
  if (configured) {
    const verified = await executablePath(configured);
    if (verified && isUserManagedExecutable(verified)) return verified;
  }
  const names = process.platform === "win32"
    ? ["lark-cli.cmd", "lark-cli.exe", "lark-cli"]
    : ["lark-cli"];
  for (const directory of (options.environment.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const verified = await executablePath(join(directory, name));
      if (verified && isUserManagedExecutable(verified)) return verified;
    }
  }
  if (process.platform === "win32" && options.environment.APPDATA) {
    for (const name of names) {
      const verified = await executablePath(join(options.environment.APPDATA, "npm", name));
      if (verified && isUserManagedExecutable(verified)) return verified;
    }
  }
  if (process.platform !== "win32" && options.shellPath) {
    try {
      const result = await options.runProcess(options.shellPath, ["-lic", "command -v lark-cli"], {
        cwd: options.homeDirectory,
        timeoutMs: 5_000,
        environment: options.environment
      });
      const candidates = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).reverse();
      for (const candidate of candidates) {
        const verified = await executablePath(candidate);
        if (verified && isUserManagedExecutable(verified)) return verified;
      }
    } catch {
      // An unavailable user shell is reported as an unavailable updater by the caller.
    }
  }
  return undefined;
}

export function larkCliProcessEnvironment(
  environment: NodeJS.ProcessEnv,
  executable: string
): NodeJS.ProcessEnv {
  const executableDirectory = dirname(executable);
  const privateNodeDirectory = environment.PI67_NODE_EXECUTABLE
    ? dirname(environment.PI67_NODE_EXECUTABLE)
    : undefined;
  const pathEntries = [executableDirectory, ...(environment.PATH ?? "").split(delimiter)]
    .filter((entry) => entry.length > 0 && (
      !privateNodeDirectory || !sameAbsolutePath(entry, privateNodeDirectory)
    ))
    .filter((entry, index, entries) => entries.findIndex((candidate) => sameAbsolutePath(candidate, entry)) === index);
  return { ...environment, PATH: pathEntries.join(delimiter) };
}

export function resolveOptionalPath(value: string | undefined): string | undefined {
  if (!value || value.includes("\0")) return undefined;
  return resolve(value);
}

async function executablePath(candidate: string): Promise<string | undefined> {
  if (!isAbsolute(candidate) || candidate.includes("\0") || candidate.includes("\"")) return undefined;
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile()) return undefined;
    if (process.platform !== "win32") await access(candidate, constants.X_OK);
    return resolve(candidate);
  } catch {
    return undefined;
  }
}

function isContainedAbsolutePath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate) || !isAbsolute(root)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    && !isAbsolute(fromRoot)
  );
}

function sameAbsolutePath(left: string, right: string): boolean {
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  return normalize(left) === normalize(right);
}
