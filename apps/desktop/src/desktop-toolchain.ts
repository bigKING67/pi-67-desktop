import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { DesktopToolchainStatus } from "@pi67/protocol";

interface ToolchainManifest {
  schema: "pi67.desktop-toolchain.v1";
  platform: "darwin" | "win32";
  architecture: "arm64" | "x64";
  versions: {
    node: string;
    npm: string;
    git: string;
  };
  paths: {
    node: string;
    npmCli: string;
    git: string;
    gitExecPath: string;
  };
}

export interface DesktopToolchain extends DesktopToolchainStatus {
  root: string;
  nodeExecutable?: string;
  npmCli?: string;
  gitExecutable?: string;
  gitExecPath?: string;
}

export function resolveDesktopToolchain(
  root: string,
  packaged: boolean,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): DesktopToolchain {
  const statusBase = {
    root: resolve(root),
    packaged,
    platform: platform === "win32" ? "win32" as const : "darwin" as const,
    architecture: architecture === "x64" ? "x64" as const : "arm64" as const
  };
  if ((platform !== "darwin" || architecture !== "arm64") && (platform !== "win32" || architecture !== "x64")) {
    return { ...statusBase, ready: false, detail: `Unsupported toolchain target ${platform}/${architecture}.` };
  }
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as ToolchainManifest;
    if (
      manifest.schema !== "pi67.desktop-toolchain.v1"
      || manifest.platform !== platform
      || manifest.architecture !== architecture
    ) {
      throw new Error("The toolchain manifest does not match this application target.");
    }
    const nodeExecutable = containedPath(root, manifest.paths.node);
    const npmCli = containedPath(root, manifest.paths.npmCli);
    const gitExecutable = containedPath(root, manifest.paths.git);
    const gitExecPath = containedPath(root, manifest.paths.gitExecPath);
    const gitRemoteHttps = resolve(
      gitExecPath,
      platform === "win32" ? "git-remote-https.exe" : "git-remote-https"
    );
    if (![nodeExecutable, npmCli, gitExecutable, gitExecPath, gitRemoteHttps].every(existsSync)) {
      throw new Error("One or more private toolchain files are missing.");
    }
    return {
      ...statusBase,
      ready: true,
      nodeVersion: manifest.versions.node,
      npmVersion: manifest.versions.npm,
      gitVersion: manifest.versions.git,
      nodeExecutable,
      npmCli,
      gitExecutable,
      gitExecPath
    };
  } catch (error) {
    return {
      ...statusBase,
      ready: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export function publicToolchainStatus(toolchain: DesktopToolchain): DesktopToolchainStatus {
  const {
    root: _root,
    nodeExecutable: _node,
    npmCli: _npm,
    gitExecutable: _git,
    gitExecPath: _gitExecPath,
    ...status
  } = toolchain;
  return status;
}

function containedPath(root: string, candidate: string): string {
  if (!candidate || isAbsolute(candidate)) throw new Error("Toolchain paths must be relative.");
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  const fromRoot = relative(resolvedRoot, resolvedCandidate);
  if (
    fromRoot === ".."
    || fromRoot.startsWith("../")
    || fromRoot.startsWith("..\\")
    || isAbsolute(fromRoot)
  ) {
    throw new Error("Toolchain path escaped its resource root.");
  }
  return resolvedCandidate;
}
