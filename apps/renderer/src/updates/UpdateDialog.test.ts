import { describe, expect, it } from "vitest";
import { updateDetail } from "./UpdateDialog.js";
import type { UpdateState } from "./update-state.js";

const base = {
  phase: "installing",
  channel: "unsigned-preview",
  currentVersion: "0.1.0-alpha.35",
  automaticChecks: true,
  version: "0.1.0-alpha.36",
  artifactBytes: 100
} as const;

describe("update installation handoff copy", () => {
  it("sets an accurate expectation for the separate Windows installer surface", () => {
    const update: UpdateState = {
      ...base,
      artifactName: "Pi-67-Desktop-0.1.0-alpha.36-win-x64-unsigned-preview.exe"
    };

    expect(updateDetail(update, true)).toContain("Windows 会继续显示独立安装进度");
    expect(updateDetail(update, true)).toContain("自动重新打开");
  });

  it("does not promise a Windows surface for the macOS replacement path", () => {
    const update: UpdateState = {
      ...base,
      artifactName: "Pi-67-Desktop-0.1.0-alpha.36-mac-arm64-unsigned-preview.zip"
    };

    expect(updateDetail(update, true)).toBe("安装包已通过 SHA-256 校验；应用即将退出、替换并重新启动。");
  });
});
