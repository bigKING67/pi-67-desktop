import { describe, expect, it } from "vitest";
import { classifyMarkdownLink } from "./markdown-link.js";

describe("classifyMarkdownLink", () => {
  it("separates external and workspace links", () => {
    expect(classifyMarkdownLink("https://example.test/docs?q=1")).toEqual({
      kind: "external",
      href: "https://example.test/docs?q=1"
    });
    expect(classifyMarkdownLink("./apps/renderer/src/main%20view.tsx#L10-L20")).toEqual({
      kind: "workspace",
      relativePath: "apps/renderer/src/main view.tsx",
      fragment: "L10-L20"
    });
    expect(classifyMarkdownLink(".\\src\\main.ts")).toEqual({
      kind: "workspace",
      relativePath: "src/main.ts"
    });
  });

  it("rejects absolute, escaping, malformed, and active-scheme links", () => {
    for (const href of [
      "/etc/passwd",
      "C:\\Windows\\system.ini",
      "../outside.ts",
      "src/../../outside.ts",
      "file:///tmp/a",
      "javascript:alert(1)",
      "%E0%A4%A"
    ]) {
      expect(classifyMarkdownLink(href)).toEqual({ kind: "unsupported" });
    }
  });
});
