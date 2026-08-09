import type { SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { projectSessionCompatibility } from "./session-compatibility-projection.js";

describe("projectSessionCompatibility", () => {
  it("reports compatible current-format Sessions", () => {
    expect(projectSessionCompatibility(manager(3), [userEntry()])).toEqual({
      status: "compatible",
      currentSupportedVersion: 3,
      sessionFormatVersion: 3,
      unknownEntryCount: 0,
      unrenderableMessageCount: 0,
      mutationSafe: true
    });
  });

  it("keeps known content readable while reporting future and unknown entries", () => {
    const unknown = {
      type: "future_event",
      id: "future-1",
      parentId: "message-1",
      timestamp: "2026-08-09T00:00:01.000Z",
      secretBody: "must-not-cross-the-projection"
    } as unknown as SessionEntry;
    const result = projectSessionCompatibility(manager(4), [userEntry(), unknown]);
    expect(result).toMatchObject({
      status: "future-format",
      sessionFormatVersion: 4,
      unknownEntryCount: 1,
      unrenderableMessageCount: 0
    });
    expect(JSON.stringify(result)).not.toContain("must-not-cross-the-projection");
  });
});

function manager(version: number) {
  const header: SessionHeader = {
    type: "session",
    version,
    id: "session-1",
    cwd: "/workspace",
    timestamp: "2026-08-09T00:00:00.000Z"
  };
  return { getHeader: () => header };
}

function userEntry(): SessionEntry {
  return {
    type: "message",
    id: "message-1",
    parentId: null,
    timestamp: "2026-08-09T00:00:00.000Z",
    message: { role: "user", content: "hello", timestamp: 1 }
  };
}
