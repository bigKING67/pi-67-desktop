import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationOrganizationStore } from "./conversation-organization-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ConversationOrganizationStore", () => {
  it("persists only a hashed Session identity and restores organization state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-conversation-organization-"));
    roots.push(root);
    const fileIdentity = "session-file-v1\0private-identity";
    const first = new ConversationOrganizationStore(root);
    await first.set("source-a", fileIdentity, { pinnedAt: 123 });

    const serialized = await readFile(join(root, "conversation-organization", "organization-v2.json"), "utf8");
    expect(serialized).not.toContain(fileIdentity);
    expect(serialized).not.toContain("private-title");

    const restored = new ConversationOrganizationStore(root);
    await restored.initialize();
    expect(restored.get("source-a", fileIdentity)).toEqual({ pinnedAt: 123 });
  });

  it("removes empty organization records", async () => {
    const store = new ConversationOrganizationStore();
    await store.set("source", "session-file-v1\0one", { archivedAt: 456 });
    await store.set("source", "session-file-v1\0one", {});
    expect(store.get("source", "session-file-v1\0one")).toEqual({});
  });

  it("keeps organization on physical identity instead of a reused locator", async () => {
    const store = new ConversationOrganizationStore();
    await store.set("source", "session-file-v1\0physical-a", { archivedAt: 456 });

    expect(store.get("source", "session-file-v1\0physical-a")).toEqual({ archivedAt: 456 });
    expect(store.get("source", "session-file-v1\0physical-b")).toEqual({});
  });
});
