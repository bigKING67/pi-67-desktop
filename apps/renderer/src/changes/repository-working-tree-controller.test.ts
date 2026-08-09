import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  beginDetail: vi.fn(),
  finishDetail: vi.fn(),
  failDetail: vi.fn(),
  inspectRepositoryWorkingTree: vi.fn(),
  readRepositoryChangeDetail: vi.fn(),
  publishNotification: vi.fn()
}));

vi.mock("./repository-working-tree-store.js", () => ({
  useRepositoryWorkingTreeStore: {
    getState: () => mocks
  }
}));
vi.mock("../notifications/notification-store.js", () => ({
  publishNotification: mocks.publishNotification
}));

import {
  loadRepositoryChangeDetail,
  refreshRepositoryWorkingTree
} from "./repository-working-tree-controller.js";

describe("repository working tree controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.begin.mockReturnValue(7);
    mocks.beginDetail.mockReturnValue(true);
    mocks.fail.mockReturnValue(true);
    mocks.failDetail.mockReturnValue(true);
    vi.stubGlobal("window", {
      pi67: {
        system: {
          inspectRepositoryWorkingTree: mocks.inspectRepositoryWorkingTree,
          readRepositoryChangeDetail: mocks.readRepositoryChangeDetail
        }
      }
    });
  });

  it("finishes an exact Workspace snapshot", async () => {
    const snapshot = workingTreeSnapshot();
    mocks.inspectRepositoryWorkingTree.mockResolvedValueOnce(snapshot);

    await refreshRepositoryWorkingTree("workspace-a");

    expect(mocks.begin).toHaveBeenCalledWith("workspace-a");
    expect(mocks.finish).toHaveBeenCalledWith("workspace-a", 7, snapshot);
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });

  it("reports a snapshot bound to another Workspace", async () => {
    mocks.inspectRepositoryWorkingTree.mockResolvedValueOnce(workingTreeSnapshot("workspace-b"));

    await refreshRepositoryWorkingTree("workspace-a");

    expect(mocks.fail).toHaveBeenCalledWith(
      "workspace-a",
      7,
      "Repository snapshot belongs to another Workspace."
    );
    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "warning",
      title: "无法读取工作区变更",
      message: "Repository snapshot belongs to another Workspace."
    });
  });

  it("does not notify when a failed refresh has already become stale", async () => {
    mocks.inspectRepositoryWorkingTree.mockRejectedValueOnce("offline");
    mocks.fail.mockReturnValueOnce(false);

    await refreshRepositoryWorkingTree("workspace-a");

    expect(mocks.fail).toHaveBeenCalledWith("workspace-a", 7, "工作区变更暂时不可用。");
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });

  it("does not read a detail rejected by the current projection", async () => {
    mocks.beginDetail.mockReturnValueOnce(false);

    await loadRepositoryChangeDetail("workspace-a", 3, "change-a");

    expect(mocks.readRepositoryChangeDetail).not.toHaveBeenCalled();
  });

  it("finishes an accepted change detail", async () => {
    const detail = changeDetail();
    mocks.readRepositoryChangeDetail.mockResolvedValueOnce(detail);

    await loadRepositoryChangeDetail("workspace-a", 3, "change-a");

    expect(mocks.readRepositoryChangeDetail).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      revision: 3,
      changeId: "change-a"
    });
    expect(mocks.finishDetail).toHaveBeenCalledWith(detail);
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });

  it("reports an active detail failure", async () => {
    mocks.readRepositoryChangeDetail.mockRejectedValueOnce(new Error("diff unavailable"));

    await loadRepositoryChangeDetail("workspace-a", 3, "change-a");

    expect(mocks.failDetail).toHaveBeenCalledWith(
      "workspace-a",
      3,
      "change-a",
      "diff unavailable"
    );
    expect(mocks.publishNotification).toHaveBeenCalledWith({
      level: "warning",
      title: "无法读取 Git Diff",
      message: "diff unavailable"
    });
  });

  it("does not notify when a failed detail request has become stale", async () => {
    mocks.readRepositoryChangeDetail.mockRejectedValueOnce("offline");
    mocks.failDetail.mockReturnValueOnce(false);

    await loadRepositoryChangeDetail("workspace-a", 3, "change-a");

    expect(mocks.failDetail).toHaveBeenCalledWith(
      "workspace-a",
      3,
      "change-a",
      "工作区变更暂时不可用。"
    );
    expect(mocks.publishNotification).not.toHaveBeenCalled();
  });
});

function workingTreeSnapshot(workspaceId = "workspace-a") {
  return {
    workspaceId,
    revision: 3,
    observedAt: 1,
    changes: [],
    truncated: false
  };
}

function changeDetail() {
  return {
    workspaceId: "workspace-a",
    revision: 3,
    changeId: "change-a",
    contentFingerprint: "fingerprint-a",
    truncated: false
  };
}
