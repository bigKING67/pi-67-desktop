import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  writeFile: mocks.writeFile
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/Users/me/Downloads") },
  dialog: { showSaveDialog: mocks.showSaveDialog }
}));

import type { AuthorizedIpcHandle } from "./authorized-ipc.js";
import { registerTeamChatAttachmentSaveBridge, teamChatSaveFileName } from "./team-chat-attachment-save.js";

function register() {
  const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
  const handle = ((channel: string, listener: (event: unknown, value: unknown) => unknown) => {
    handlers.set(channel, listener);
  }) as unknown as AuthorizedIpcHandle;
  registerTeamChatAttachmentSaveBridge(handle, () => undefined);
  return (value: unknown) => handlers.get("pi67:team-chat-attachment-save")!({}, value);
}

describe("Team Chat attachment save bridge", () => {
  beforeEach(() => {
    mocks.showSaveDialog.mockReset();
    mocks.writeFile.mockReset();
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("writes the bytes only where the user chose, suggesting a cleaned name in Downloads", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/Users/me/Desktop/报表.xlsx" });
    const save = register();
    await expect(save({ fileName: "../报表.xlsx", data: new Uint8Array([1, 2, 3]).buffer })).resolves.toBe(true);
    expect(mocks.showSaveDialog).toHaveBeenCalledWith({ title: "保存附件", defaultPath: "/Users/me/Downloads/_报表.xlsx" });
    const [path, bytes] = mocks.writeFile.mock.calls[0] as [string, Uint8Array];
    expect(path).toBe("/Users/me/Desktop/报表.xlsx");
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("writes nothing when the user cancels", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: "" });
    await expect(register()({ fileName: "a.png", data: new Uint8Array([1]).buffer })).resolves.toBe(false);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("refuses malformed requests before any dialog", async () => {
    const save = register();
    for (const value of [
      undefined,
      { fileName: "", data: new Uint8Array([1]).buffer },
      { fileName: "a.png", data: new Uint8Array([1]) },
      { fileName: "a.png", data: new ArrayBuffer(0) },
      { fileName: "a.png", data: new ArrayBuffer(25 * 1024 * 1024 + 1) },
      { fileName: "名".repeat(201), data: new Uint8Array([1]).buffer }
    ]) {
      await expect(save(value)).rejects.toThrow(/Invalid attachment/);
    }
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  });

  it("suggests names without directories, controls or reserved characters", () => {
    expect(teamChatSaveFileName("a/b\\c:d*?.pdf")).toBe("a_b_c_d__.pdf");
    expect(teamChatSaveFileName("..\u0000x.txt ")).toBe("_x.txt");
    expect(teamChatSaveFileName("...")).toBe("attachment");
  });
});
