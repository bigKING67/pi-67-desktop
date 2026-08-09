import { describe, expect, it } from "vitest";
import { isUsageReportRequestCurrent } from "./usage-report-request.js";

describe("usage report request authority", () => {
  it("accepts only the exact request, Host epoch, and Settings Workspace", () => {
    const expected = { revision: 4, hostEpoch: 9, workspaceId: "workspace-a" };

    expect(isUsageReportRequestCurrent(expected, {
      revision: 4,
      connected: true,
      hostEpoch: 9,
      workspaceId: "workspace-a"
    })).toBe(true);
    expect(isUsageReportRequestCurrent(expected, {
      revision: 5,
      connected: true,
      hostEpoch: 9,
      workspaceId: "workspace-a"
    })).toBe(false);
    expect(isUsageReportRequestCurrent(expected, {
      revision: 4,
      connected: true,
      hostEpoch: 10,
      workspaceId: "workspace-a"
    })).toBe(false);
    expect(isUsageReportRequestCurrent(expected, {
      revision: 4,
      connected: true,
      hostEpoch: 9,
      workspaceId: "workspace-b"
    })).toBe(false);
    expect(isUsageReportRequestCurrent(expected, {
      revision: 4,
      connected: false,
      hostEpoch: 9,
      workspaceId: "workspace-a"
    })).toBe(false);
  });
});
