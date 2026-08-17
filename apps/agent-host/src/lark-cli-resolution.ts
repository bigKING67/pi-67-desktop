import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

export async function resolveLarkCli(options: {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  shellPath: string | undefined;
  runProcess: SkillPackProcessRunner;
  platform?: NodeJS.Platform;
}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const privateToolchainRoot = resolveOptionalPath(options.environment.PI67_TOOLCHAIN_ROOT);
  const isUserManagedExecutable = (candidate: string): boolean => (
    !privateToolchainRoot || !isContainedAbsolutePath(candidate, privateToolchainRoot)
  );
  const managed = await executablePath(
    desktopManagedLarkCliExecutable(options.homeDirectory, platform),
    platform
  );
  if (managed) return managed;
  const sharedLauncher = await executablePath(
    userGlobalLarkCliLauncher(options.homeDirectory, options.environment, platform),
    platform
  );
  if (sharedLauncher) return sharedLauncher;
  const agentDir = resolveOptionalPath(options.environment.PI_CODING_AGENT_DIR);
  if (agentDir) {
    const legacyManaged = await executablePath(legacyDesktopManagedLarkCliExecutable(agentDir, platform), platform);
    if (legacyManaged) return legacyManaged;
  }
  const configured = options.environment.PI67_LARK_CLI_PATH;
  if (configured) {
    const verified = await preferredLarkCliExecutable(configured, platform);
    if (verified && isUserManagedExecutable(verified)) return verified;
  }
  const names = platform === "win32"
    ? ["lark-cli.exe", "lark-cli.cmd", "lark-cli"]
    : ["lark-cli"];
  for (const directory of (options.environment.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const verified = await preferredLarkCliExecutable(join(directory, name), platform);
      if (verified && isUserManagedExecutable(verified)) return verified;
    }
  }
  if (platform === "win32" && options.environment.APPDATA) {
    for (const name of names) {
      const verified = await preferredLarkCliExecutable(
        join(options.environment.APPDATA, "npm", name),
        platform
      );
      if (verified && isUserManagedExecutable(verified)) return verified;
    }
  }
  if (platform !== "win32" && options.shellPath) {
    try {
      const result = await options.runProcess(options.shellPath, ["-lic", "command -v lark-cli"], {
        cwd: options.homeDirectory,
        timeoutMs: 5_000,
        environment: options.environment
      });
      const candidates = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).reverse();
      for (const candidate of candidates) {
        const verified = await executablePath(candidate, platform);
        if (verified && isUserManagedExecutable(verified)) return verified;
      }
    } catch {
      // An unavailable user shell is reported as an unavailable updater by the caller.
    }
  }
  return undefined;
}

export function desktopManagedLarkCliRoot(homeDirectory: string): string {
  return join(resolve(homeDirectory), ".agents", "tools", "lark-cli");
}

export function desktopManagedLarkCliExecutable(
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform
): string {
  return join(
    desktopManagedLarkCliRoot(homeDirectory),
    "node_modules",
    "@larksuite",
    "cli",
    "bin",
    platform === "win32" ? "lark-cli.exe" : "lark-cli"
  );
}

export function globalAgentSkillsRoot(homeDirectory: string): string {
  return join(resolve(homeDirectory), ".agents", "skills");
}

export function userGlobalLarkCliLauncher(
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "win32") {
    const appData = resolveOptionalPath(environment.APPDATA)
      ?? join(resolve(homeDirectory), "AppData", "Roaming");
    return join(appData, "npm", "lark-cli.exe");
  }
  return join(resolve(homeDirectory), ".local", "bin", "lark-cli");
}

export function isDesktopManagedLarkCliExecutable(
  executable: string,
  homeDirectory: string
): boolean {
  return isContainedAbsolutePath(executable, desktopManagedLarkCliRoot(homeDirectory));
}

function legacyDesktopManagedLarkCliExecutable(
  agentDir: string,
  platform: NodeJS.Platform
): string {
  return join(
    resolve(agentDir),
    "desktop-capabilities",
    "tools",
    "lark-cli",
    "node_modules",
    "@larksuite",
    "cli",
    "bin",
    platform === "win32" ? "lark-cli.exe" : "lark-cli"
  );
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
  return {
    ...environment,
    PATH: pathEntries.join(delimiter),
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
  };
}

export function resolveOptionalPath(value: string | undefined): string | undefined {
  if (!value || value.includes("\0")) return undefined;
  return resolve(value);
}

async function executablePath(candidate: string, platform: NodeJS.Platform): Promise<string | undefined> {
  if (!isAbsolute(candidate) || candidate.includes("\0") || candidate.includes("\"")) return undefined;
  try {
    const metadata = await stat(candidate);
    if (!metadata.isFile()) return undefined;
    if (platform !== "win32") await access(candidate, constants.X_OK);
    return resolve(candidate);
  } catch {
    return undefined;
  }
}

async function preferredLarkCliExecutable(
  candidate: string,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  const verified = await executablePath(candidate, platform);
  if (!verified || platform !== "win32" || !verified.toLowerCase().endsWith(".cmd")) return verified;
  const native = join(
    dirname(verified),
    "node_modules",
    "@larksuite",
    "cli",
    "bin",
    "lark-cli.exe"
  );
  return await executablePath(native, platform) ?? verified;
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
