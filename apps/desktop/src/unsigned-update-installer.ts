import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { SupportedUpdatePlatform } from "./unsigned-preview-update.js";
import { ensureUnsignedUpdateDirectory } from "./unsigned-update-directory.js";

const execFileAsync = promisify(execFile);
const macosBundleName = "Pi-67 Desktop.app";
const macosBundleIdentifier = "com.pi67.desktop";

interface SpawnedProcess {
  once(event: "error" | "spawn", listener: ((error: Error) => void) | (() => void)): this;
  unref(): void;
}

interface InstallUnsignedUpdateOptions {
  platform: SupportedUpdatePlatform;
  version: string;
  downloadPath: string;
  executablePath: string;
  updateRoot: string;
  processId: number;
  quit: () => void;
  runCommand?: (file: string, arguments_: readonly string[]) => Promise<{ stdout: string }>;
  spawnDetached?: (file: string, arguments_: readonly string[]) => SpawnedProcess;
  randomId?: () => string;
}

export async function installUnsignedUpdate(options: InstallUnsignedUpdateOptions): Promise<void> {
  if (options.platform === "win32") {
    if (!options.downloadPath.endsWith(".exe")) {
      throw new Error("The verified Windows update is not an NSIS executable.");
    }
    await spawnAndConfirm(options, options.downloadPath, ["--updated", "/S"]);
    options.quit();
    return;
  }

  const helper = await prepareMacosUnsignedUpdate(options);
  await spawnAndConfirm(options, "/bin/sh", [
    helper.scriptPath,
    String(options.processId),
    helper.currentBundlePath,
    helper.stagedBundlePath,
    helper.backupBundlePath,
    helper.stagingRoot
  ]);
  options.quit();
}

export function resolveMacosApplicationBundle(executablePath: string): string {
  const bundle = dirname(dirname(dirname(resolve(executablePath))));
  if (!bundle.endsWith(".app")) {
    throw new Error("Pi-67 is not running from a macOS application bundle.");
  }
  return bundle;
}

async function prepareMacosUnsignedUpdate(options: InstallUnsignedUpdateOptions): Promise<{
  scriptPath: string;
  currentBundlePath: string;
  stagedBundlePath: string;
  backupBundlePath: string;
  stagingRoot: string;
}> {
  if (!options.downloadPath.endsWith(".zip")) {
    throw new Error("The verified macOS update is not a ZIP application bundle.");
  }
  const runCommand = options.runCommand ?? defaultRunCommand;
  const randomId = options.randomId ?? randomUUID;
  const currentBundlePath = resolveMacosApplicationBundle(options.executablePath);
  const currentParent = dirname(currentBundlePath);
  await access(currentParent, fsConstants.W_OK).catch(() => {
    throw new Error("Pi-67 cannot update this macOS installation because its parent folder is not writable.");
  });
  await assertMacosBundleIdentity(currentBundlePath, undefined, runCommand);

  await ensureUnsignedUpdateDirectory(options.updateRoot);
  const identifier = randomId();
  if (!/^[a-zA-Z0-9-]{8,80}$/u.test(identifier)) {
    throw new Error("Pi-67 generated an invalid update staging identity.");
  }
  const stagingRoot = join(options.updateRoot, `macos-stage-${identifier}`);
  const scriptPath = join(options.updateRoot, `install-${identifier}.sh`);
  const backupBundlePath = join(currentParent, `.${basename(currentBundlePath)}.pi67-backup-${identifier}`);
  await assertPathMissing(stagingRoot);
  await assertPathMissing(scriptPath);
  await assertPathMissing(backupBundlePath);
  await mkdir(stagingRoot, { recursive: false, mode: 0o700 });

  try {
    await runCommand("/usr/bin/ditto", ["-x", "-k", "--noqtn", options.downloadPath, stagingRoot]);
    const entries = await readdir(stagingRoot, { withFileTypes: true });
    if (
      entries.length !== 1
      || entries[0]?.name !== macosBundleName
      || !entries[0].isDirectory()
      || entries[0].isSymbolicLink()
    ) {
      throw new Error("The macOS update archive must contain exactly one Pi-67 application bundle.");
    }
    const stagedBundlePath = join(stagingRoot, macosBundleName);
    await assertMacosBundleIdentity(stagedBundlePath, options.version, runCommand);
    const [stagingDevice, targetDevice] = await Promise.all([
      stat(stagingRoot).then((metadata) => metadata.dev),
      stat(currentParent).then((metadata) => metadata.dev)
    ]);
    if (stagingDevice !== targetDevice) {
      throw new Error("The macOS update staging directory is not on the installation volume.");
    }

    await writeFile(scriptPath, macosInstallerScript(), { encoding: "utf8", mode: 0o700, flag: "wx" });
    return { scriptPath, currentBundlePath, stagedBundlePath, backupBundlePath, stagingRoot };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(scriptPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function assertMacosBundleIdentity(
  bundlePath: string,
  expectedVersion: string | undefined,
  runCommand: NonNullable<InstallUnsignedUpdateOptions["runCommand"]>
): Promise<void> {
  const metadata = await lstat(bundlePath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The macOS update bundle is not a regular application directory.");
  }
  const infoPath = join(bundlePath, "Contents", "Info.plist");
  const executablePath = join(bundlePath, "Contents", "MacOS", "Pi-67 Desktop");
  const [identifier, version, executable] = await Promise.all([
    runCommand("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPath]),
    runCommand("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPath]),
    lstat(executablePath)
  ]);
  if (identifier.stdout.trim() !== macosBundleIdentifier) {
    throw new Error("The macOS update bundle identifier is invalid.");
  }
  if (expectedVersion !== undefined && version.stdout.trim() !== expectedVersion) {
    throw new Error("The macOS update bundle version does not match the verified manifest.");
  }
  if (!executable.isFile() || executable.isSymbolicLink()) {
    throw new Error("The macOS update bundle executable is invalid.");
  }
}

function spawnAndConfirm(
  options: InstallUnsignedUpdateOptions,
  file: string,
  arguments_: readonly string[]
): Promise<void> {
  const spawnDetached = options.spawnDetached ?? defaultSpawnDetached;
  return new Promise((resolvePromise, reject) => {
    const child = spawnDetached(file, arguments_);
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
  throw new Error("Pi-67 update staging encountered an existing path.");
}

async function defaultRunCommand(file: string, arguments_: readonly string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync(file, [...arguments_], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1_048_576
  });
  return { stdout: result.stdout };
}

function defaultSpawnDetached(file: string, arguments_: readonly string[]): ChildProcess {
  return spawn(file, [...arguments_], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
}

function macosInstallerScript(): string {
  return `#!/bin/sh
set -u
pid="$1"
target="$2"
staged="$3"
backup="$4"
staging_root="$5"

attempt=0
while /bin/kill -0 "$pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    exit 20
  fi
  /bin/sleep 0.2
done

if [ -e "$backup" ] || [ ! -d "$target" ] || [ ! -d "$staged" ]; then
  exit 21
fi

if ! /bin/mv "$target" "$backup"; then
  exit 22
fi

if ! /bin/mv "$staged" "$target"; then
  /bin/mv "$backup" "$target" >/dev/null 2>&1 || true
  exit 23
fi

if /usr/bin/open -n "$target" --args --updated; then
  /bin/rm -rf "$backup"
  /bin/rm -rf "$staging_root"
  /bin/rm -f "$0"
  exit 0
fi

/bin/rm -rf "$target"
/bin/mv "$backup" "$target" >/dev/null 2>&1 || true
/usr/bin/open -n "$target" >/dev/null 2>&1 || true
exit 24
`;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
