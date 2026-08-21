import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installUnsignedUpdate,
  resolveMacosApplicationBundle
} from "./unsigned-update-installer.js";

const temporaryDirectories: string[] = [];

describe("unsigned update platform installer", () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("starts the existing per-user NSIS update mode before requesting app quit", async () => {
    const events: string[] = [];
    const spawnDetached = vi.fn((_file: string, _arguments: readonly string[]) => fakeSpawn(events));
    const quit = vi.fn(() => events.push("quit"));

    await installUnsignedUpdate({
      platform: "win32",
      version: "0.1.0-alpha.2",
      downloadPath: "C:\\Pi67\\update.exe",
      executablePath: "C:\\Pi67\\Pi-67 Desktop.exe",
      updateRoot: "C:\\Pi67\\updates",
      processId: 42,
      quit,
      spawnDetached
    });

    expect(spawnDetached).toHaveBeenCalledWith("C:\\Pi67\\update.exe", ["--updated", "/S"]);
    expect(events).toEqual(["spawn", "unref", "quit"]);
  });

  it("stages and validates one macOS bundle before starting the rollback helper", async () => {
    const root = await temporaryDirectory();
    const currentBundle = join(root, "Pi-67 Desktop.app");
    const executablePath = await createApplicationBundle(currentBundle);
    const archivePath = join(root, "update.zip");
    const updateRoot = join(root, "updates");
    await writeFile(archivePath, "fixture");
    const events: string[] = [];
    const spawnDetached = vi.fn((_file: string, _arguments: readonly string[]) => fakeSpawn(events));
    const runCommand = vi.fn(async (file: string, arguments_: readonly string[]) => {
      if (file === "/usr/bin/ditto") {
        const stagingRoot = arguments_.at(-1);
        if (!stagingRoot) throw new Error("Missing staging root");
        await createApplicationBundle(join(stagingRoot, "Pi-67 Desktop.app"));
        return { stdout: "" };
      }
      if (file === "/usr/bin/plutil" && arguments_[1] === "CFBundleIdentifier") {
        return { stdout: "com.pi67.desktop\n" };
      }
      if (file === "/usr/bin/plutil" && arguments_[1] === "CFBundleShortVersionString") {
        return { stdout: "0.1.0-alpha.2\n" };
      }
      throw new Error(`Unexpected command: ${file}`);
    });
    const quit = vi.fn(() => events.push("quit"));

    await installUnsignedUpdate({
      platform: "darwin",
      version: "0.1.0-alpha.2",
      downloadPath: archivePath,
      executablePath,
      updateRoot,
      processId: 42,
      quit,
      runCommand,
      spawnDetached,
      randomId: () => "fixture-id-1234"
    });

    expect(resolveMacosApplicationBundle(executablePath)).toBe(currentBundle);
    expect(spawnDetached).toHaveBeenCalledOnce();
    const invocation = spawnDetached.mock.calls[0];
    expect(invocation?.[0]).toBe("/bin/sh");
    expect(invocation?.[1]).toEqual([
      join(updateRoot, "install-fixture-id-1234.sh"),
      "42",
      currentBundle,
      join(updateRoot, "macos-stage-fixture-id-1234", "Pi-67 Desktop.app"),
      join(root, ".Pi-67 Desktop.app.pi67-backup-fixture-id-1234"),
      join(updateRoot, "macos-stage-fixture-id-1234")
    ]);
    const script = await readFile(join(updateRoot, "install-fixture-id-1234.sh"), "utf8");
    expect(script).toContain('/bin/mv "$target" "$backup"');
    expect(script).toContain('/bin/mv "$backup" "$target"');
    expect(events).toEqual(["spawn", "unref", "quit"]);
  });

  it("rejects a macOS payload whose bundle version does not match the manifest", async () => {
    const root = await temporaryDirectory();
    const currentBundle = join(root, "Pi-67 Desktop.app");
    const executablePath = await createApplicationBundle(currentBundle);
    const archivePath = join(root, "update.zip");
    await writeFile(archivePath, "fixture");
    const runCommand = vi.fn(async (file: string, arguments_: readonly string[]) => {
      if (file === "/usr/bin/ditto") {
        await createApplicationBundle(join(arguments_.at(-1)!, "Pi-67 Desktop.app"));
        return { stdout: "" };
      }
      if (arguments_[1] === "CFBundleIdentifier") return { stdout: "com.pi67.desktop\n" };
      return { stdout: arguments_.at(-1)?.startsWith(currentBundle) ? "0.1.0-alpha.1\n" : "9.9.9\n" };
    });

    await expect(installUnsignedUpdate({
      platform: "darwin",
      version: "0.1.0-alpha.2",
      downloadPath: archivePath,
      executablePath,
      updateRoot: join(root, "updates"),
      processId: 42,
      quit: vi.fn(),
      runCommand,
      spawnDetached: vi.fn(),
      randomId: () => "fixture-id-5678"
    })).rejects.toThrow("version");
  });

  it("rejects a symbolic-link macOS update root before extracting the archive", async () => {
    const root = await temporaryDirectory();
    const currentBundle = join(root, "Pi-67 Desktop.app");
    const executablePath = await createApplicationBundle(currentBundle);
    const archivePath = join(root, "update.zip");
    const target = join(root, "update-target");
    const updateRoot = join(root, "updates");
    await writeFile(archivePath, "fixture");
    await mkdir(target);
    await symlink(target, updateRoot);
    const runCommand = vi.fn(async (file: string, arguments_: readonly string[]) => {
      if (file === "/usr/bin/plutil" && arguments_[1] === "CFBundleIdentifier") {
        return { stdout: "com.pi67.desktop\n" };
      }
      if (file === "/usr/bin/plutil" && arguments_[1] === "CFBundleShortVersionString") {
        return { stdout: "0.1.0-alpha.1\n" };
      }
      throw new Error(`Unexpected command: ${file}`);
    });

    await expect(installUnsignedUpdate({
      platform: "darwin",
      version: "0.1.0-alpha.2",
      downloadPath: archivePath,
      executablePath,
      updateRoot,
      processId: 42,
      quit: vi.fn(),
      runCommand,
      spawnDetached: vi.fn(),
      randomId: () => "fixture-id-9012"
    })).rejects.toThrow("update directory");
    expect(runCommand).not.toHaveBeenCalledWith("/usr/bin/ditto", expect.anything());
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi67-update-installer-"));
  temporaryDirectories.push(path);
  return path;
}

async function createApplicationBundle(bundlePath: string): Promise<string> {
  const executablePath = join(bundlePath, "Contents", "MacOS", "Pi-67 Desktop");
  await mkdir(join(bundlePath, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(bundlePath, "Contents", "Info.plist"), "fixture");
  await writeFile(executablePath, "fixture", { mode: 0o700 });
  return executablePath;
}

function fakeSpawn(events: string[]) {
  return {
    once(event: "error" | "spawn", listener: ((error: Error) => void) | (() => void)) {
      if (event === "spawn") {
        events.push("spawn");
        (listener as () => void)();
      }
      return this;
    },
    unref() {
      events.push("unref");
    }
  };
}
