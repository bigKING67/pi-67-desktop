import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  processIdsForExecutable,
  resolveMacosPreviewTarget
} from "./preview-macos-unsigned.mjs";

describe("macOS unsigned preview workflow", () => {
  it("resolves only the supported macOS Apple Silicon artifact", () => {
    const root = "/workspace/pi-67-desktop";
    const target = resolveMacosPreviewTarget("darwin", "arm64", root);
    expect(target.applicationPath).toBe(join(root, "artifacts/release/mac-arm64/Pi-67 Desktop.app"));
    expect(target.asarPath).toBe(join(target.applicationPath, "Contents/Resources/app.asar"));
    expect(target.executablePath).toBe(join(target.applicationPath, "Contents/MacOS/Pi-67 Desktop"));
    expect(() => resolveMacosPreviewTarget("win32", "x64", root)).toThrow(/only supports darwin\/arm64/u);
  });

  it("matches the exact preview executable without collecting Electron helpers", () => {
    const executable = "/workspace/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop";
    const processList = [
      `  101 ${executable}`,
      `  102 ${executable} --inspect=0`,
      "  103 /workspace/Pi-67 Desktop.app/Contents/Frameworks/Pi-67 Desktop Helper",
      "  104 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
    ].join("\n");
    expect(processIdsForExecutable(processList, executable)).toEqual([101, 102]);
  });
});
