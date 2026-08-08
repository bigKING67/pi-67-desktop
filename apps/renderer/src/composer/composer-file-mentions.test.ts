import { describe, expect, it } from "vitest";
import {
  composerFileMentionQuery,
  insertComposerFileMention,
  mergeComposerFileReference,
  removeComposerFileReference,
  referencesPresentInComposerText
} from "./composer-file-mentions.js";

const entry = {
  id: "file-a",
  revision: "revision-a",
  relativePath: "src/main.ts",
  name: "main.ts",
  kind: "file" as const
};

describe("composer file mentions", () => {
  it("detects only the active at-query at the cursor", () => {
    expect(composerFileMentionQuery("inspect @mai")).toEqual({ query: "mai", start: 8, end: 12 });
    expect(composerFileMentionQuery("email@example.com")).toBeUndefined();
    expect(composerFileMentionQuery("@[src/main.ts]")).toBeUndefined();
  });

  it("inserts a durable text token and opaque reference", () => {
    expect(insertComposerFileMention("inspect @mai", composerFileMentionQuery("inspect @mai")!, entry))
      .toEqual({
        text: "inspect @[src/main.ts] ",
        cursor: 23,
        reference: { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
      });
  });

  it("replaces a renewed identity and drops references whose tokens were removed", () => {
    const renewed = { id: "file-a", revision: "revision-b", relativePath: "src/main.ts" };
    expect(mergeComposerFileReference([{
      id: "file-a",
      revision: "revision-a",
      relativePath: "src/main.ts"
    }], renewed)).toEqual([renewed]);
    expect(referencesPresentInComposerText("no file token", [renewed])).toEqual([]);
    expect(referencesPresentInComposerText("use @[src/main.ts]", [renewed])).toEqual([renewed]);
  });

  it("removes only the exact reference tokens and keeps a legal cursor", () => {
    expect(removeComposerFileReference(
      "compare @[src/main.ts] with @[src/other.ts] and @[src/main.ts]",
      64,
      { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
    )).toEqual({
      text: "compare with @[src/other.ts] and",
      cursor: 32
    });
    expect(removeComposerFileReference(
      "@[src/main.ts] next",
      4,
      { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
    )).toEqual({ text: "next", cursor: 0 });
  });
});
