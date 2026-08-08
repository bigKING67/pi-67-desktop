import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => ({
  lstat: vi.fn(),
  readFile: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  lstat: fileSystem.lstat,
  readFile: fileSystem.readFile
}));

import { collectPiConfigurationDiagnostics } from "./support-diagnostics.js";

describe("Pi configuration diagnostic error classification", () => {
  const agentDirectory = process.platform === "win32" ? "C:\\pi67-agent" : "/tmp/pi67-agent";

  beforeEach(() => {
    fileSystem.lstat.mockReset();
    fileSystem.readFile.mockReset();
  });

  it("classifies an inaccessible Agent Directory without inspecting child files", async () => {
    fileSystem.lstat.mockRejectedValue(fileError("EACCES"));

    await expect(collectPiConfigurationDiagnostics({
      agentDirectory,
      agentDirectorySource: "default",
      environment: { PI_CODING_AGENT_DIR: agentDirectory }
    })).resolves.toMatchObject({
      agentDirectory: { state: "unreadable", errorClass: "access-denied" },
      files: [
        { file: "auth.json", state: "directory-unavailable" },
        { file: "settings.json", state: "directory-unavailable" },
        { file: "models.json", state: "directory-unavailable" }
      ]
    });
    expect(fileSystem.lstat).toHaveBeenCalledOnce();
    expect(fileSystem.readFile).not.toHaveBeenCalled();
  });

  it("maps bounded file metadata failures without retaining raw errors", async () => {
    fileSystem.lstat.mockImplementation(async (path: string) => {
      if (path === agentDirectory) return directoryMetadata();
      if (path === join(agentDirectory, "auth.json")) throw fileError("EIO");
      if (path === join(agentDirectory, "settings.json")) throw fileError("ENOTDIR");
      throw fileError("ELOOP");
    });

    const diagnostics = await collectPiConfigurationDiagnostics({
      agentDirectory,
      agentDirectorySource: "environment",
      environment: { PI_CODING_AGENT_DIR: agentDirectory }
    });

    expect(diagnostics.files).toEqual([
      { file: "auth.json", state: "unreadable", errorClass: "io" },
      { file: "settings.json", state: "unreadable", errorClass: "not-directory" },
      { file: "models.json", state: "unreadable", errorClass: "path-loop" }
    ]);
  });

  it("distinguishes unreadable content, non-files, symlinks, missing files, and unknown errors", async () => {
    fileSystem.lstat.mockImplementation(async (path: string) => {
      if (path === agentDirectory) return directoryMetadata();
      if (path === join(agentDirectory, "auth.json")) return fileMetadata();
      if (path === join(agentDirectory, "settings.json")) return fileMetadata({ file: false });
      return fileMetadata({ symbolicLink: true });
    });
    fileSystem.readFile.mockRejectedValue(fileError("EPERM"));

    await expect(collectPiConfigurationDiagnostics({
      agentDirectory,
      agentDirectorySource: "environment",
      environment: { PI_CODING_AGENT_DIR: agentDirectory }
    })).resolves.toMatchObject({
      files: [
        expect.objectContaining({ file: "auth.json", state: "unreadable", errorClass: "access-denied" }),
        expect.objectContaining({ file: "settings.json", state: "not-file" }),
        expect.objectContaining({ file: "models.json", state: "symlink" })
      ]
    });

    fileSystem.lstat.mockImplementation(async (path: string) => {
      if (path === agentDirectory) return directoryMetadata();
      if (path === join(agentDirectory, "auth.json")) throw fileError("ENOENT");
      if (path === join(agentDirectory, "settings.json")) throw fileError("UNEXPECTED");
      return fileMetadata();
    });
    fileSystem.readFile.mockResolvedValue("{}");

    await expect(collectPiConfigurationDiagnostics({
      agentDirectory,
      agentDirectorySource: "environment",
      environment: { PI_CODING_AGENT_DIR: agentDirectory }
    })).resolves.toMatchObject({
      files: [
        { file: "auth.json", state: "missing" },
        { file: "settings.json", state: "unreadable", errorClass: "unknown" },
        expect.objectContaining({ file: "models.json", state: "valid-json" })
      ]
    });
  });
});

function directoryMetadata() {
  return {
    isSymbolicLink: () => false,
    isDirectory: () => true
  };
}

function fileMetadata(options: { file?: boolean; symbolicLink?: boolean } = {}) {
  return {
    size: 2,
    mtimeMs: 1,
    isSymbolicLink: () => options.symbolicLink === true,
    isFile: () => options.file !== false
  };
}

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error("raw error must not escape"), { code });
}
