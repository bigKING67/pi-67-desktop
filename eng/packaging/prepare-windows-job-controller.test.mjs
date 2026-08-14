import { describe, expect, it, vi } from "vitest";
import {
  prepareWindowsJobController,
  quoteWindowsCommandValue,
  windowsJobControllerCompilerCommand
} from "./prepare-windows-job-controller.mjs";

describe("Windows Package Worker Job controller build", () => {
  it("is not required outside Windows and rejects unsupported Windows architecture", async () => {
    await expect(prepareWindowsJobController("darwin", "arm64")).resolves.toEqual({ status: "not-required" });
    await expect(prepareWindowsJobController("win32", "arm64"))
      .rejects.toThrow("does not support win32/arm64");
  });

  it("quotes only bounded Windows command values", () => {
    expect(quoteWindowsCommandValue("C:\\Program Files\\Microsoft Visual Studio\\VsDevCmd.bat"))
      .toBe('"C:\\Program Files\\Microsoft Visual Studio\\VsDevCmd.bat"');
    expect(() => quoteWindowsCommandValue("bad\npath")).toThrow("path is invalid");
    expect(() => quoteWindowsCommandValue('bad"path')).toThrow("path is invalid");
    expect(() => quoteWindowsCommandValue("bad%PATH%path")).toThrow("path is invalid");
  });

  it("does not invoke the compiler on a non-Windows host", async () => {
    const run = vi.fn();
    await prepareWindowsJobController("linux", "x64", {}, run);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps compiler intermediates inside the ignored native artifact directory", () => {
    const command = windowsJobControllerCompilerCommand(
      "C:\\VS\\VsDevCmd.bat",
      "C:\\repo\\windows-package-worker-job.cpp",
      "C:\\repo\\artifacts\\native\\windows-x64\\pi67-package-worker-job.exe",
      "C:\\repo\\artifacts\\native\\windows-x64\\pi67-package-worker-job.obj"
    );

    expect(command).toContain('/Fo:"C:\\repo\\artifacts\\native\\windows-x64\\pi67-package-worker-job.obj"');
    expect(command).toContain('/Fe:"C:\\repo\\artifacts\\native\\windows-x64\\pi67-package-worker-job.exe"');
    expect(command).toContain('"C:\\repo\\windows-package-worker-job.cpp"');
    expect(command).toContain("/W4 /WX /O2");
  });
});
