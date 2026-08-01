import type { LoadExtensionsResult, SourceInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { projectExtensionCommands } from "./extension-commands.js";

describe("projectExtensionCommands", () => {
  it("uses Pi's collision-resolved names, preserves command sources, and excludes hidden sources", () => {
    const visibleSource = source("/extensions/visible.ts");
    const hiddenSource = source("<inline:hidden>");
    const extensions = {
      extensions: [
        { path: visibleSource.path, resolvedPath: visibleSource.path, sourceInfo: visibleSource, hidden: false },
        { path: hiddenSource.path, resolvedPath: hiddenSource.path, sourceInfo: hiddenSource, hidden: true }
      ],
      errors: [],
      runtime: {
        getCommands: () => [
          { name: "build:1", description: "First", source: "extension", sourceInfo: visibleSource },
          { name: "build:2", description: "Second", source: "extension", sourceInfo: visibleSource },
          { name: "internal", source: "extension", sourceInfo: hiddenSource },
          { name: "skill:review", source: "skill", sourceInfo: visibleSource }
        ]
      }
    } as unknown as LoadExtensionsResult;

    expect(projectExtensionCommands(extensions)).toEqual({
      items: [
        { name: "build:1", source: "extension", description: "First" },
        { name: "build:2", source: "extension", description: "Second" },
        { name: "skill:review", source: "skill" }
      ],
      total: 3,
      truncated: false
    });
  });

  it("attaches only the Adapter metadata bound to Pi's resolved invocation name", () => {
    const visibleSource = source("/extensions/visible.ts");
    const extensions = {
      extensions: [
        { path: visibleSource.path, resolvedPath: visibleSource.path, sourceInfo: visibleSource, hidden: false }
      ],
      errors: [],
      runtime: {
        getCommands: () => [
          { name: "inspect:2", description: "Pi description", source: "extension", sourceInfo: visibleSource },
          { name: "inspect:3", source: "extension", sourceInfo: visibleSource }
        ]
      }
    } as unknown as LoadExtensionsResult;
    const adapter = {
      adapterId: "verified",
      package: "@verified/example",
      label: "检查",
      description: "Adapter description"
    };

    expect(projectExtensionCommands(extensions, new Map([["inspect:2", adapter]]))).toEqual({
      items: [
        { name: "inspect:2", source: "extension", description: "Pi description", adapter },
        { name: "inspect:3", source: "extension" }
      ],
      total: 2,
      truncated: false
    });
  });
});

function source(path: string): SourceInfo {
  return { path, source: path, scope: "temporary", origin: "top-level" };
}
