import { describe, expect, it } from "vitest";
import { zhCNExtensionPackageMessages } from "./zh-cn-extension-packages.js";

describe("Chinese Extension package copy", () => {
  it("uses reviewed Chinese purposes for known npm and Git package identities", () => {
    expect(zhCNExtensionPackageMessages.purpose(
      "npm:pi-subagents@0.35.1",
      undefined,
      "Pi extension for delegating tasks to subagents."
    )).toBe("将任务委派给子代理，支持任务链、并行执行和交互式澄清。");
    expect(zhCNExtensionPackageMessages.purpose(
      "https://github.com/arpagon/pi-rewind.git",
      undefined,
      "Checkpoint/rewind extension for Pi."
    )).toContain("检查点与回退");
  });

  it("preserves a package-authored Chinese description", () => {
    expect(zhCNExtensionPackageMessages.purpose(
      "npm:example-extension",
      "example-extension",
      "  为当前会话提供可复核的示例能力。  "
    )).toBe("为当前会话提供可复核的示例能力。");
  });

  it("replaces unknown non-Chinese metadata with an explicit Chinese fallback", () => {
    const purpose = zhCNExtensionPackageMessages.purpose(
      "npm:unknown-extension",
      undefined,
      "An extension without reviewed localized metadata."
    );
    expect(purpose).toContain("暂未收录对应中文文案");
    expect(purpose).not.toContain("without reviewed localized metadata");
  });
});
