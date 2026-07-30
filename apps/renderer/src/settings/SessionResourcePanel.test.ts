import type { ResourceSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { filterSessionResources } from "./SessionResourcePanel.js";

const resources: ResourceSummary[] = [
  resource("package-extension", "package", "user"),
  resource("global-local", "top-level", "user"),
  resource("project-local", "top-level", "project"),
  resource("package-skill", "package", "user", "skill"),
  resource("global-skill", "top-level", "user", "skill"),
  resource("project-skill", "top-level", "project", "skill")
];

describe("SessionResourcePanel filtering", () => {
  it("keeps package extensions out of the local extension view", () => {
    expect(filterSessionResources(resources, "extension", "project", "top-level")
      .map((entry) => entry.id)).toEqual(["project-local", "global-local"]);
  });

  it("keeps project-local extensions out of the global scope", () => {
    expect(filterSessionResources(resources, "extension", "global", "top-level")
      .map((entry) => entry.id)).toEqual(["global-local"]);
  });

  it("separates top-level global and project skills without repeating package skills", () => {
    expect(filterSessionResources(resources, "skill", "global", "top-level", "user")
      .map((entry) => entry.id)).toEqual(["global-skill"]);
    expect(filterSessionResources(resources, "skill", "project", "top-level", "project")
      .map((entry) => entry.id)).toEqual(["project-skill"]);
  });
});

function resource(
  id: string,
  origin: NonNullable<ResourceSummary["origin"]>,
  scope: NonNullable<ResourceSummary["scope"]>,
  kind: ResourceSummary["kind"] = "extension"
): ResourceSummary {
  return { kind, id, label: id, origin, scope, status: "ready" };
}
