import { describe, expect, it } from "vitest";
import {
  shouldCreateInitialRealUserSession,
  waitForCatalogState
} from "./windows-real-user-catalog-state.mjs";

describe("Windows real-user Catalog state", () => {
  it("accepts a Catalog state only after the expected materialized Session is present", async () => {
    const workspaceGroup = {
      evaluate: async (_callback, expectedIdentity) => ({
        hasExpectedSession: expectedIdentity === "session:workspace-1:session.jsonl",
        itemCount: 1,
        text: "Workspace Session"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(
      window,
      "session:workspace-1:session.jsonl",
      100
    )).resolves.toMatchObject({ itemCount: 1, state: "ready" });
  });

  it("reports bounded expected JSONL and identity evidence when a restart row is missing", async () => {
    const expectedIdentity = "session:workspace-1:session-file-v1\0private-device\0private-inode";
    const workspaceGroup = {
      evaluate: async () => ({
        catalogIncomplete: "false",
        catalogItemCount: "0",
        catalogRebuilding: "false",
        catalogRevision: "7",
        catalogSource: "sqlite",
        catalogState: "ready",
        catalogVisibleCount: "0",
        hasExpectedSession: false,
        itemCount: 0,
        provisionalItemCount: 0,
        sessionIdentities: [],
        text: "这个工作区还没有会话"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    let failure;
    await waitForCatalogState(window, expectedIdentity, 10, {
      launchIndex: 1,
      inspectExpectedSessionFile: async () => ({
        expected: true,
        exists: true,
        isFile: true,
        byteLength: 321,
        fileIdentityFingerprint: "0123456789ab"
      }),
      inspectSessionCatalogDiscovery: async () => ({
        currentFileIdentityFingerprint: "0123456789ab",
        discoveryState: "complete",
        expectedIdentityFileFingerprint: "0123456789ab",
        expectedPhysicalRecordPresent: true,
        expectedRecordWorkspaceMatch: false,
        incomplete: false,
        recordCount: 1,
        skippedCount: 0,
        workspaceMatchedRecordCount: 0
      })
    }).catch((error) => { failure = String(error); });

    expect(failure).toContain('"state":"ready-empty"');
    expect(failure).toContain('"catalogState":"ready"');
    expect(failure).toContain('"catalogSource":"sqlite"');
    expect(failure).toContain('"catalogRevision":"7"');
    expect(failure).toContain('"launchIndex":1');
    expect(failure).toContain('"byteLength":321');
    expect(failure).toContain('"fileIdentityFingerprint":"0123456789ab"');
    expect(failure).toContain('"expectedPhysicalRecordPresent":true');
    expect(failure).toContain('"expectedRecordWorkspaceMatch":false');
    expect(failure).not.toContain(expectedIdentity);
    expect(failure).not.toContain("private-device");
  });

  it("reports an uninitialized Store instead of inferring ready-empty from localized text", async () => {
    const workspaceGroup = {
      evaluate: async () => ({
        catalogIncomplete: "false",
        catalogItemCount: "0",
        catalogRebuilding: "false",
        catalogRevision: "uninitialized",
        catalogSource: "uninitialized",
        catalogState: "uninitialized",
        catalogVisibleCount: "0",
        hasExpectedSession: true,
        itemCount: 0,
        provisionalItemCount: 0,
        sessionIdentities: [],
        text: "这个工作区还没有会话"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(window, undefined, 10)).rejects.toThrow(
      /"catalogState":"uninitialized".*"state":null/
    );
  });

  it("fails closed when the installed Catalog reports unavailable", async () => {
    const workspaceGroup = {
      evaluate: async () => ({
        hasExpectedSession: true,
        itemCount: 0,
        text: "Session 目录暂不可用，可稍后刷新重试。"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(window, undefined, 100)).rejects.toThrow(
      "Session Catalog became unavailable"
    );
  });

  it("recognizes the first provisional Session as an in-flight empty-Catalog creation", async () => {
    const workspaceGroup = {
      evaluate: async () => ({
        hasExpectedSession: true,
        itemCount: 0,
        provisionalItemCount: 1,
        text: "未命名会话 尚未保存 当前草稿"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(window, undefined, 100)).resolves.toMatchObject({
      itemCount: 0,
      state: "creating"
    });
  });

  it("does not accept a provisional Session while restoring an exact persisted Session", async () => {
    const workspaceGroup = {
      evaluate: async () => ({
        hasExpectedSession: false,
        itemCount: 0,
        provisionalItemCount: 1,
        text: "未命名会话 尚未保存 当前草稿"
      }),
      waitFor: async () => undefined
    };
    const window = {
      getByTestId: () => ({ first: () => workspaceGroup })
    };

    await expect(waitForCatalogState(
      window,
      "session:workspace-1:expected.jsonl",
      10
    )).rejects.toThrow('"provisionalItemCount":1');
  });

  it.each([
    ["ready empty", { itemCount: 0, state: "ready-empty" }, true],
    ["rebuilding empty", { itemCount: 0, state: "rebuilding" }, true],
    ["creation already in flight", { itemCount: 0, state: "creating" }, false],
    ["materialized", { itemCount: 1, state: "ready" }, false]
  ])("creates the first real-user Session before activation for %s Catalog state", (
    _label,
    catalog,
    expected
  ) => {
    expect(shouldCreateInitialRealUserSession({
      catalog,
      expectedSessionIdentity: undefined,
      launchIndex: 0
    })).toBe(expected);
  });

  it("requires the exact persisted Session on real-user restarts", () => {
    expect(shouldCreateInitialRealUserSession({
      catalog: { itemCount: 0, state: "ready-empty" },
      expectedSessionIdentity: "session:workspace-1:session.jsonl",
      launchIndex: 1
    })).toBe(false);
  });
});
