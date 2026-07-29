import type {
  AgentSessionServices,
  LoadExtensionsResult,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { isPathWithin, projectSessionResources } from "./session-snapshot.js";

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

    expect(projectSessionResources(services, extensions)).toEqual([
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
