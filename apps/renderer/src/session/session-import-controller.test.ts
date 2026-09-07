import { afterEach, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";
import { importRendererSessionFile } from "./session-import-controller.js";

vi.mock("../app/renderer-session-transaction.js", () => ({ prepareRendererSessionTransaction: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("abandons the pending file selection when its Workspace is no longer current", async () => {
  let resolve!: (path: string) => void;
  const picker = vi.fn(() => new Promise<string>((release) => { resolve = release; }));
  vi.stubGlobal("window", { pi67: { system: { selectSessionFile: picker } } });
  useAppStore.setState({ workspace: "/workspace-a", sessionTransitionPending: false });
  const request = vi.spyOn(agentConnectionController, "request");
  const pending = importRendererSessionFile();
  expect(picker).toHaveBeenCalledOnce();
  useAppStore.setState({ workspace: "/workspace-b" });
  resolve("/fixture/session.jsonl");
  await pending;
  expect(request).not.toHaveBeenCalled();
  expect(prepareRendererSessionTransaction).not.toHaveBeenCalled();
  expect(useAppStore.getState().sessionTransitionPending).toBe(false);
});
