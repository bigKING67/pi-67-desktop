import { describe, expect, it } from "vitest";
import {
  authorizePrivateMemoryUri,
  defaultPrivateMemoryScope,
  isPrivateMemoryRoot,
  resolvePrivateMemoryScope,
} from "./private-uri-policy.js";

const config = { user: "local-owner", peerId: "workspace-peer" };

describe("OpenViking private URI policy", () => {
  it("allows only current-user and current-peer Memory trees", () => {
    expect(authorizePrivateMemoryUri("viking://user/memories/preferences/editor.md", config).ok).toBe(true);
    expect(authorizePrivateMemoryUri("viking://user/local-owner/memories/events/task.md", config).ok).toBe(true);
    expect(authorizePrivateMemoryUri("viking://user/peers/workspace-peer/memories/experiences/e.md", config).ok).toBe(true);
    expect(authorizePrivateMemoryUri("viking://user/local-owner/peers/workspace-peer/memories/cases/c.md", config).ok).toBe(true);
  });

  it.each([
    "viking://resources/team/secret.md",
    "viking://user/other/memories/private.md",
    "viking://user/local-owner/peers/other/memories/private.md",
    "viking://session/session-1/history/archive_001",
    "viking://user/memories/../resources/secret.md",
    "viking://user/memories/%2e%2e/resources/secret.md",
    "viking://user/memories%2f..%2fresources/secret.md",
    "viking://user/memories/file.md?account=other",
  ])("rejects cross-boundary or ambiguous URI %s", (uri) => {
    expect(authorizePrivateMemoryUri(uri, config).ok).toBe(false);
  });

  it("maps simple Tool scopes to bounded private roots", () => {
    expect(defaultPrivateMemoryScope(config)).toBe("viking://user/peers/workspace-peer/memories");
    expect(resolvePrivateMemoryScope("workspace", config)).toEqual({
      ok: true,
      uri: "viking://user/peers/workspace-peer/memories",
    });
    expect(resolvePrivateMemoryScope("user", config)).toEqual({ ok: true, uri: "viking://user/memories" });
    expect(isPrivateMemoryRoot("viking://user/memories", config)).toBe(true);
    expect(isPrivateMemoryRoot("viking://user/memories/events/item.md", config)).toBe(false);
  });
});
