import type { EnterpriseProjectSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { selectEnterpriseProjectId, type ContextMemoryOverview } from "./context-memory-controller.js";

describe("selectEnterpriseProjectId", () => {
  it("restores the remotely bound project instead of replacing it with the first active project", () => {
    const projects: EnterpriseProjectSummary[] = [
      project("project-active"),
      project("project-bound")
    ];
    const overview = {
      binding: {
        state: "bound",
        workspaceId: "workspace-1",
        enterpriseProjectId: "project-bound",
        enterpriseProjectName: "Bound project",
        accountId: "account-1",
        boundAt: Date.now()
      }
    } as ContextMemoryOverview;

    expect(selectEnterpriseProjectId(overview, projects)).toBe("project-bound");
  });

  it("falls back to the first active project only when no remote binding exists", () => {
    const projects = [project("project-active")];
    const overview = {
      binding: { state: "unbound", workspaceId: "workspace-1" }
    } as ContextMemoryOverview;

    expect(selectEnterpriseProjectId(overview, projects)).toBe("project-active");
  });
});

function project(id: string): EnterpriseProjectSummary {
  return {
    id,
    accountId: "account-1",
    name: id,
    slug: id,
    status: "active",
    bindingCount: 1,
    candidateCount: 0,
    sharedAssetCount: 0,
    updatedAt: Date.now()
  };
}
