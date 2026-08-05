import { describe, expect, it } from "vitest";
import {
  detectWorkspaceFileFormat,
  reconcileWorkspaceFileFormat,
  syncWorkspaceFileNameFormat,
  validateWorkspaceFileName,
  workspaceFileNameSelectionEnd
} from "./workspace-file-name.js";

describe("Workspace file naming", () => {
  it("matches the Host filename boundary before a mutation is sent", () => {
    expect(validateWorkspaceFileName("main.ts")).toBeUndefined();
    expect(validateWorkspaceFileName("项目说明.md")).toBeUndefined();
    expect(validateWorkspaceFileName("")).toBe("请输入名称。");
    expect(validateWorkspaceFileName(".")).toBe("名称不能是 . 或 ..。");
    expect(validateWorkspaceFileName("..")).toBe("名称不能是 . 或 ..。");
    expect(validateWorkspaceFileName("src/main.ts")).toBe("名称不能包含 / 或 \\。");
    expect(validateWorkspaceFileName("src\\main.ts")).toBe("名称不能包含 / 或 \\。");
    expect(validateWorkspaceFileName("bad\nname.ts")).toBe("名称不能包含控制字符。");
    expect(validateWorkspaceFileName("trailing. ")).toBe("名称不能以点或空格结尾。");
    expect(validateWorkspaceFileName(".git")).toBe("不能通过文件面板管理 .git 元数据。");
    expect(validateWorkspaceFileName("CON.txt")).toBe("该名称是 Windows 保留名称，请使用其他名称。");
    expect(validateWorkspaceFileName("lpt9.JSON")).toBe("该名称是 Windows 保留名称，请使用其他名称。");
    expect(validateWorkspaceFileName("x".repeat(256))).toBe("名称不能超过 255 个字符。");
  });

  it("detects the editor format from the final extension", () => {
    expect(detectWorkspaceFileFormat("component.tsx")).toEqual({ label: "TypeScript", extension: ".tsx" });
    expect(detectWorkspaceFileFormat("settings.yml")).toEqual({ label: "YAML", extension: ".yml" });
    expect(detectWorkspaceFileFormat("Makefile")).toEqual({ label: "尚未识别类型" });
    expect(detectWorkspaceFileFormat("archive.rst")).toEqual({ label: "自定义格式", extension: ".rst" });
  });

  it("synchronizes an explicit format without creating a second file-type authority", () => {
    expect(syncWorkspaceFileNameFormat("notes", "markdown")).toBe("notes.md");
    expect(syncWorkspaceFileNameFormat("notes.txt", "typescript")).toBe("notes.ts");
    expect(syncWorkspaceFileNameFormat("notes.ts", "auto")).toBe("notes.ts");
    expect(syncWorkspaceFileNameFormat("", "json")).toBe("");
    expect(reconcileWorkspaceFileFormat("typescript", "main.ts")).toBe("typescript");
    expect(reconcileWorkspaceFileFormat("typescript", "main.js")).toBe("auto");
  });

  it("selects only a renamed file basename while preserving its extension", () => {
    expect(workspaceFileNameSelectionEnd("main.test.ts", "rename-file")).toBe(9);
    expect(workspaceFileNameSelectionEnd("README", "rename-file")).toBe(6);
    expect(workspaceFileNameSelectionEnd("README-copy.md", "save-as")).toBe(11);
    expect(workspaceFileNameSelectionEnd("src", "rename-directory")).toBe(3);
  });
});
