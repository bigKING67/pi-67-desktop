import type {
  AgentSessionServices,
  LoadExtensionsResult,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import {
  MAX_RESOURCE_CATALOG_ITEMS,
  MAX_RESOURCE_DETAIL_CHARS,
  MAX_RESOURCE_ID_CHARS,
  MAX_RESOURCE_LABEL_CHARS,
  MAX_RESOURCE_PATH_CHARS,
  MAX_RESOURCE_SOURCE_CHARS
} from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { isPathWithin, projectSessionResourceCatalog } from "./session-snapshot.js";

describe("session resource projection", () => {
  it("keeps Pi resource kinds, scopes, and package origins explicit", () => {
    const services = {
      agentDir: "/Users/test/.pi/agent",
      resourceLoader: {
        getSkills: () => ({
          skills: [{
            name: "design-craft",
            description: "Design workflow",
            filePath: "/Users/test/.agents/skills/design-craft/SKILL.md",
            baseDir: "/Users/test/.agents/skills/design-craft",
            sourceInfo: source("/Users/test/.agents/skills/design-craft", "~/.agents/skills", "user", "top-level"),
            disableModelInvocation: false
          }],
          diagnostics: []
        }),
        getPrompts: () => ({
          prompts: [{
            name: "review",
            description: "Review changes",
            content: "Review staged changes",
            filePath: "/workspace/.pi/prompts/review.md",
            sourceInfo: source("/workspace/.pi/prompts/review.md", "npm:pi-review", "project", "package")
          }],
          diagnostics: []
        }),
        getAgentsFiles: () => ({
          agentsFiles: [{ path: "/Users/test/.pi/agent/AGENTS.md", content: "global" }, {
            path: "/workspace/AGENTS.md",
            content: "project"
          }]
        })
      }
    } as unknown as AgentSessionServices;
    const extensions = {
      extensions: [{
        path: ".pi/extensions/project.ts",
        resolvedPath: "/workspace/.pi/extensions/project.ts",
        sourceInfo: source("/workspace/.pi/extensions/project.ts", ".pi/extensions", "project", "top-level")
      }],
      errors: [],
      runtime: {}
    } as unknown as LoadExtensionsResult;

    expect(projectSessionResourceCatalog(services, extensions).resources).toEqual([
      expect.objectContaining({
        kind: "skill",
        label: "design-craft",
        scope: "user",
        origin: "top-level",
        source: "~/.agents/skills"
      }),
      expect.objectContaining({
        kind: "prompt",
        label: "/review",
        scope: "project",
        origin: "package",
        source: "npm:pi-review"
      }),
      expect.objectContaining({
        kind: "extension",
        label: "project.ts",
        path: "/workspace/.pi/extensions/project.ts",
        scope: "project",
        origin: "top-level"
      }),
      expect.objectContaining({ kind: "context", path: "/Users/test/.pi/agent/AGENTS.md", scope: "user" }),
      expect.objectContaining({ kind: "context", path: "/workspace/AGENTS.md", scope: "project" })
    ]);
  });

  it("bounds catalog items and strings while reporting the exact projection disposition", () => {
    const oversized = "\u{1F642}".repeat(MAX_RESOURCE_PATH_CHARS * 2);
    const skills = Array.from({ length: MAX_RESOURCE_CATALOG_ITEMS + 44 }, (_, index) => ({
      name: `skill-${index}-${"n".repeat(MAX_RESOURCE_ID_CHARS)}`,
      description: "unused",
      filePath: `/workspace/${oversized}/${index}/SKILL.md`,
      baseDir: `/workspace/${oversized}/${index}`,
      sourceInfo: source(
        `/workspace/${oversized}/${index}`,
        `npm:${oversized}`,
        "project",
        "package"
      ),
      disableModelInvocation: false
    }));
    const services = {
      agentDir: "/Users/test/.pi/agent",
      resourceLoader: {
        getSkills: () => ({ skills, diagnostics: [] }),
        getPrompts: () => ({ prompts: [], diagnostics: [] }),
        getAgentsFiles: () => ({ agentsFiles: [] })
      }
    } as unknown as AgentSessionServices;
    const errors = [{ path: oversized, error: oversized }];
    const extensions = { extensions: [], errors, runtime: {} } as unknown as LoadExtensionsResult;

    const projection = projectSessionResourceCatalog(services, extensions);

    expect(projection.resourceCatalog.totalItems).toBe(MAX_RESOURCE_CATALOG_ITEMS + 45);
    expect(projection.resourceCatalog.projectedItems).toBe(projection.resources.length);
    expect(projection.resourceCatalog.projectedItems).toBeLessThan(MAX_RESOURCE_CATALOG_ITEMS);
    expect(projection.resourceCatalog.omittedItems).toBeGreaterThan(0);
    expect(projection.resourceCatalog.truncatedFields).toBeGreaterThan(0);
    expect(projection.resourceCatalog.truncated).toBe(true);
    for (const resource of projection.resources) {
      expect(resource.id.length).toBeLessThanOrEqual(MAX_RESOURCE_ID_CHARS);
      expect(resource.label.length).toBeLessThanOrEqual(MAX_RESOURCE_LABEL_CHARS);
      expect(resource.path?.length ?? 0).toBeLessThanOrEqual(MAX_RESOURCE_PATH_CHARS);
      expect(resource.source?.length ?? 0).toBeLessThanOrEqual(MAX_RESOURCE_SOURCE_CHARS);
      expect(resource.detail?.length ?? 0).toBeLessThanOrEqual(MAX_RESOURCE_DETAIL_CHARS);
    }
    expect(Buffer.byteLength(JSON.stringify(projection), "utf8")).toBeLessThan(512 * 1024);
  });

  it("compares Windows context paths without case sensitivity", () => {
    expect(isPathWithin(
      "C:\\Users\\Test\\.pi\\agent\\AGENTS.md",
      "c:\\users\\test\\.pi\\agent",
      "win32"
    )).toBe(true);
    expect(isPathWithin(
      "C:\\Users\\Test\\project\\AGENTS.md",
      "c:\\users\\test\\.pi\\agent",
      "win32"
    )).toBe(false);
    expect(isPathWithin("/Users/Test/.pi/agent/AGENTS.md", "/users/test/.pi/agent", "darwin")).toBe(false);
  });
});

function source(
  path: string,
  sourceName: string,
  scope: SourceInfo["scope"],
  origin: SourceInfo["origin"]
): SourceInfo {
  return { path, source: sourceName, scope, origin };
}
