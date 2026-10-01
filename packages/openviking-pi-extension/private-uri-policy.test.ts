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

  it("maps simple Tool scopes to canonical current-user roots", () => {
    expect(defaultPrivateMemoryScope(config)).toBe("viking://user/local-owner/peers/workspace-peer/memories");
    expect(resolvePrivateMemoryScope("workspace", config)).toEqual({
      ok: true,
      uri: "viking://user/local-owner/peers/workspace-peer/memories",
    });
    expect(resolvePrivateMemoryScope("user", config)).toEqual({ ok: true, uri: "viking://user/local-owner/memories" });
    expect(isPrivateMemoryRoot("viking://user/memories", config)).toBe(true);
    expect(isPrivateMemoryRoot("viking://user/memories/events/item.md", config)).toBe(false);
  });

  it("never emits uid-less user URIs, which OpenViking 0.4.17+ rejects", () => {
    expect(authorizePrivateMemoryUri("viking://user/memories/events/item.md", config))
      .toEqual({ ok: true, uri: "viking://user/local-owner/memories/events/item.md" });
    expect(authorizePrivateMemoryUri("viking://user/peers/workspace-peer/memories/cases/c.md", config))
      .toEqual({ ok: true, uri: "viking://user/local-owner/peers/workspace-peer/memories/cases/c.md" });
    const anonymous = { user: "", peerId: "workspace-peer" };
    expect(defaultPrivateMemoryScope(anonymous)).toBe("viking://~/peers/workspace-peer/memories");
    expect(resolvePrivateMemoryScope("user", anonymous)).toEqual({ ok: true, uri: "viking://~/memories" });
    expect(authorizePrivateMemoryUri("viking://user/memories/a.md", anonymous)).toEqual({ ok: true, uri: "viking://~/memories/a.md" });
    expect(authorizePrivateMemoryUri("viking://user/someone/memories/a.md", anonymous).ok).toBe(false);
  });
});
