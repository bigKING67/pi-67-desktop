import type { WorkspaceDescriptor } from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { importRendererSessionFile } from "../session/session-import-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { importSessionIntoWorkspace } from "./workspace-conversation-actions.js";

vi.mock("../session/session-import-controller.js", () => ({ importRendererSessionFile: vi.fn() }));
vi.mock("../workspace/workspace-open-controller.js", () => ({ openRendererWorkspaceDescriptor: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });
const workspace: WorkspaceDescriptor = {
  id: "workspace-b", displayName: "B", identity: { canonicalPath: "/workspace-b", assurance: "path-only" },
  trust: "untrusted", trustProvenance: "native-picker", availability: "available"
};

describe("Workspace-targeted Session import", () => {
  it.each([false, true])("imports only after target Workspace opens: %s", async (opened) => {
    useAppStore.setState({ workspace: "/workspace-a" });
    vi.mocked(openRendererWorkspaceDescriptor).mockResolvedValue(opened);
    await importSessionIntoWorkspace(workspace);
    expect(importRendererSessionFile).toHaveBeenCalledTimes(opened ? 1 : 0);
  });
});
