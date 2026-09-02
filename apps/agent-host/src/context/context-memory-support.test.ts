import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION, type ContextMemoryConfiguration } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectMemoryOwnerConflicts,
  inspectMemoryOwnerRuntime
} from "./memory-conflict-detector.js";
import {
  appContextAuthority,
  assertPrivateMemoryUri,
  contextStatusResult,
  deriveWorkspacePeerId,
  isPrivateMemoryUri,
  memoryScopeForUri,
  memorySummary,
  titleForUri
} from "./context-memory-support.js";

const roots: string[] = [];
const configuration: ContextMemoryConfiguration = {
  ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
  revision: "test"
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("context memory support", () => {
  it("resolves truthful owner health without exposing the canonical path", () => {
    expect(contextStatusResult(configuration, [], "healthy")).toMatchObject({
      owner: "pi67-openviking",
      health: "healthy"
    });
    expect(contextStatusResult(configuration, ["pi-hy-memory"], "conflict")).toMatchObject({
      owner: "pi-default-compaction",
      conflictExtensions: ["pi-hy-memory"]
    });
    expect(contextStatusResult({ ...configuration, enabled: false }, [], "disabled").owner)
      .toBe("pi-default-compaction");
    expect(deriveWorkspacePeerId("/Users/person/private/project")).toMatch(/^[a-f0-9]{64}$/);
    expect(deriveWorkspacePeerId("/Users/person/private/project")).not.toContain("person");
    expect(appContextAuthority().context).toEqual({ scope: "app" });
  });

  it("normalizes memory summaries and fails closed outside private memory", () => {
    expect(memorySummary({
      uri: "viking://user/memories/host%20recovery",
      context_type: "memory",
      score: 0.9,
      abstract: "Recovered the Host"
    }, "workspace", "workspace-1")).toMatchObject({
      title: "host recovery",
      summary: "Recovered the Host",
      workspaceId: "workspace-1"
    });
    expect(titleForUri("viking://user/memories/windows_process-cleanup")).toBe("windows process cleanup");
    expect(titleForUri("viking://user/memories/%E0%A4%A")).toBe("%E0%A4%A");
    expect(() => assertPrivateMemoryUri("viking://resources/team/item")).toThrow("Only private user memories");
    expect(() => assertPrivateMemoryUri("viking://user/memories/item")).not.toThrow();
    const peer = "a".repeat(64);
    const canonicalWorkspace = `viking://user/local-owner/peers/${peer}/memories/events/item.md`;
    expect(() => assertPrivateMemoryUri(canonicalWorkspace)).not.toThrow();
    expect(isPrivateMemoryUri("viking://user/local-owner/memories/entities/item.md")).toBe(true);
    expect(memoryScopeForUri(canonicalWorkspace)).toBe("workspace");
    expect(memoryScopeForUri("viking://user/local-owner/memories/entities/item.md")).toBe("user");
    expect(() => assertPrivateMemoryUri("viking://user/local-owner/resources/item.md")).toThrow();
  });

  it("detects legacy and duplicate OpenViking owners deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-memory-conflicts-"));
    roots.push(root);
    await expect(detectMemoryOwnerConflicts(root)).resolves.toEqual([]);
    const owners = [
      "pi-hy-memory",
      "pi-observational-memory",
      "pi67-openviking",
      "openviking-copy"
    ];
    await Promise.all([
      ...owners.map((owner) => mkdir(join(root, "extensions", owner), { recursive: true })),
      mkdir(join(root, "extensions", "unrelated"), { recursive: true })
    ]);
    await Promise.all(owners.map((owner) => writeFile(
      join(root, "extensions", owner, "index.ts"),
      "export default function owner() {}\n",
      "utf8"
    )));
    await expect(detectMemoryOwnerConflicts(root)).resolves.toEqual([
      "openviking-copy",
      "pi-hy-memory",
      "pi-observational-memory",
      "pi67-openviking"
    ]);
    await expect(inspectMemoryOwnerRuntime(root)).resolves.toMatchObject({
      installedOwners: [
        "openviking-copy",
        "pi-hy-memory",
        "pi-observational-memory",
        "pi67-openviking"
      ],
      enabledOwners: [
        "openviking-copy",
        "pi-hy-memory",
        "pi-observational-memory",
        "pi67-openviking"
      ],
      state: "conflict"
    });
  });

  it("excludes retired Memory owners without reporting a competing-owner conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-retired-memory-owners-"));
    roots.push(root);
    const owners = ["pi-hy-memory", "pi-observational-memory"];
    await Promise.all(owners.map((owner) => (
      mkdir(join(root, "extensions", owner), { recursive: true })
    )));
    await Promise.all(owners.map((owner) => writeFile(
      join(root, "extensions", owner, "index.ts"),
      "export default function retiredOwner() {}\n",
      "utf8"
    )));

    await expect(detectMemoryOwnerConflicts(root)).resolves.toEqual([]);
    await expect(inspectMemoryOwnerRuntime(root)).resolves.toMatchObject({
      state: "not-configured",
      retiredOwners: owners,
      blockedOwners: owners
    });
  });
});
