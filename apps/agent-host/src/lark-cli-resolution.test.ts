import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  desktopManagedLarkCliExecutable,
  globalAgentSkillsRoot,
  resolveLarkCli,
  userGlobalLarkCliLauncher
} from "./lark-cli-resolution.js";

describe("Lark CLI resolution", () => {
  it("prefers the verified Desktop-managed native binary over a user PATH shim", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-lark-cli-resolution-"));
    const managed = desktopManagedLarkCliExecutable(root);
    const userBin = join(root, "user-bin");
    const shim = join(userBin, process.platform === "win32" ? "lark-cli.cmd" : "lark-cli");
    await mkdir(dirname(managed), { recursive: true });
    await mkdir(userBin, { recursive: true });
    await writeFile(managed, "managed", { mode: 0o755 });
    await writeFile(shim, "shim", { mode: 0o755 });

    await expect(resolveLarkCli({
      environment: {
        PATH: userBin
      },
      homeDirectory: root,
      shellPath: undefined,
      runProcess: vi.fn()
    })).resolves.toBe(resolve(managed));
  });

  it("uses the standard shared Skills root and native user launchers on both supported platforms", () => {
    const home = join("/Users", "fixture");
    expect(globalAgentSkillsRoot(home)).toBe(resolve(home, ".agents", "skills"));
    expect(userGlobalLarkCliLauncher(home, {}, "darwin"))
      .toBe(resolve(home, ".local", "bin", "lark-cli"));
    expect(userGlobalLarkCliLauncher("C:\\Users\\fixture", {
      APPDATA: "C:\\Users\\fixture\\AppData\\Roaming"
    }, "win32")).toMatch(/[\\/]npm[\\/]lark-cli\.exe$/u);
  });
});
