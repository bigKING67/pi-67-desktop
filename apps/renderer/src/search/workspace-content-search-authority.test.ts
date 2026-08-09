import { describe, expect, it } from "vitest";
import { isWorkspaceContentSearchRequestCurrent } from "./workspace-content-search-authority.js";

describe("Workspace content search request authority", () => {
  it("rejects responses after request replacement, Host recovery, disconnect, or Workspace switch", () => {
    const expected = { revision: 2, hostEpoch: 7, workspaceId: "workspace-a" };
    const current = {
      revision: 2,
      connected: true,
      hostEpoch: 7,
      workspaceId: "workspace-a"
    };

    expect(isWorkspaceContentSearchRequestCurrent(expected, current)).toBe(true);
    expect(isWorkspaceContentSearchRequestCurrent(expected, { ...current, revision: 3 })).toBe(false);
    expect(isWorkspaceContentSearchRequestCurrent(expected, { ...current, hostEpoch: 8 })).toBe(false);
    expect(isWorkspaceContentSearchRequestCurrent(expected, { ...current, connected: false })).toBe(false);
    expect(isWorkspaceContentSearchRequestCurrent(expected, { ...current, workspaceId: "workspace-b" })).toBe(false);
  });
});
