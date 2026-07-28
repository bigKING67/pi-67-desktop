import { describe, expect, it } from "vitest";
import { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";

describe("SessionWriterLeaseRegistry", () => {
  it("allows only one live writer for a canonical Session path", async () => {
    const registry = new SessionWriterLeaseRegistry(async (path) => path.toLowerCase());
    const first = await registry.reserve("workspace-a/task-a", "/Sessions/ONE.jsonl");
    registry.commit(first);

    await expect(registry.reserve("workspace-b/task-b", "/sessions/one.jsonl"))
      .rejects.toMatchObject({ code: "BUSY", details: { sessionWriterLeaseConflict: true } });
    registry.releaseTask("workspace-a/task-a");
    const second = await registry.reserve("workspace-b/task-b", "/sessions/one.jsonl");
    registry.commit(second);
    expect(registry.activeIdentityFor("workspace-b/task-b")).toBe("/sessions/one.jsonl");
  });

  it("keeps the active writer lease when a replacement is cancelled", async () => {
    const registry = new SessionWriterLeaseRegistry(async (path) => path);
    const active = await registry.reserve("task-a", "/sessions/active.jsonl");
    registry.commit(active);
    const replacement = await registry.reserve("task-a", "/sessions/replacement.jsonl");
    registry.cancel(replacement);

    expect(registry.activeIdentityFor("task-a")).toBe("/sessions/active.jsonl");
    await expect(registry.reserve("task-b", "/sessions/active.jsonl"))
      .rejects.toMatchObject({ code: "BUSY" });
    await expect(registry.reserve("task-b", "/sessions/replacement.jsonl"))
      .resolves.toMatchObject({ taskKey: "task-b" });
  });
});
