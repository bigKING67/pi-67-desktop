import { link, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";
import {
  hashPrivateValue,
  sessionWriterLeaseMetadataPath
} from "./session-writer-lease-storage.js";

const roots: string[] = [];
const registries: SessionWriterLeaseRegistry[] = [];

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.disposeAll()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionWriterLeaseRegistry", () => {
  it("reports only bounded active, pending, and integrity counts", async () => {
    const registry = track(new SessionWriterLeaseRegistry({
      canonicalize: async (path) => `physical:${path}`
    }));
    const active = await registry.reserve("workspace-private/task-active", "/private/active.jsonl");
    await registry.commit(active);
    const pending = await registry.reserve("workspace-private/task-pending", "/private/pending.jsonl");

    const diagnostics = registry.diagnostics();
    expect(diagnostics).toEqual({ activeCount: 1, pendingCount: 1, compromised: false });
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|workspace|task|jsonl/u);

    await registry.cancel(pending);
    await registry.releaseTask("workspace-private/task-active");
    expect(registry.diagnostics()).toEqual({ activeCount: 0, pendingCount: 0, compromised: false });
  });

  it("allows only one live writer for a canonical Session path", async () => {
    const registry = track(new SessionWriterLeaseRegistry({
      canonicalize: async (path) => (
        path.endsWith("ONE.jsonl") || path.endsWith("one.jsonl") ? "physical-session-one" : path
      )
    }));
    const first = await registry.reserve("workspace-a/task-a", "/Sessions/ONE.jsonl");
    await registry.commit(first);

    await expect(registry.reserve("workspace-b/task-b", "/sessions/one.jsonl"))
      .rejects.toMatchObject({ code: "BUSY", details: { sessionWriterLeaseConflict: true } });
    await registry.releaseTask("workspace-a/task-a");
    const second = await registry.reserve("workspace-b/task-b", "/sessions/one.jsonl");
    await registry.commit(second);
    expect(registry.activeIdentityFor("workspace-b/task-b")).toBe("physical-session-one");
  });

  it("rejects the same physical JSONL across independent Agent Host registries", async () => {
    const root = await temporaryRoot("pi67-session-writer-cross-host-");
    const session = join(root, "session.jsonl");
    await writeFile(session, "{}\n");
    const firstRegistry = durableRegistry(root, "host-a", 1);
    const secondRegistry = durableRegistry(root, "host-b", 2);
    const first = await firstRegistry.reserve("workspace-a/task-a", session);
    await firstRegistry.commit(first, session);

    await expect(secondRegistry.reserve("workspace-b/task-b", session))
      .rejects.toMatchObject({ code: "BUSY", details: { sessionWriterLeaseConflict: true } });
    await firstRegistry.releaseTask("workspace-a/task-a");
    await expect(secondRegistry.reserve("workspace-b/task-b", session)).resolves.toBeDefined();
  });

  it("serializes concurrent in-process reservations after asynchronous canonicalization", async () => {
    const registry = track(new SessionWriterLeaseRegistry({
      canonicalize: async () => "physical-concurrent-session"
    }));
    const outcomes = await Promise.allSettled([
      registry.reserve("task-a", "/sessions/a.jsonl"),
      registry.reserve("task-b", "/sessions/b.jsonl")
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "BUSY" }) })
    ]);
  });

  it("acquires multi-key durable leases in stable order without deadlock", async () => {
    const root = await temporaryRoot("pi67-session-writer-multi-key-");
    const identity = { primary: "physical-shared", keys: ["alias-z", "physical-shared", "alias-a"] };
    const firstRegistry = track(new SessionWriterLeaseRegistry({
      ...durableOptions(root, "host-a", 1),
      canonicalize: async () => identity
    }));
    const secondRegistry = track(new SessionWriterLeaseRegistry({
      ...durableOptions(root, "host-b", 2),
      canonicalize: async () => ({ ...identity, keys: [...identity.keys].reverse() })
    }));
    const outcomes = await Promise.allSettled([
      firstRegistry.reserve("task-a", "/sessions/a.jsonl"),
      secondRegistry.reserve("task-b", "/sessions/b.jsonl")
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  });

  it("keeps the active writer lease when a replacement is cancelled", async () => {
    const root = await temporaryRoot("pi67-session-writer-replacement-cancel-");
    const activePath = join(root, "active.jsonl");
    const replacementPath = join(root, "replacement.jsonl");
    await Promise.all([writeFile(activePath, "{}\n"), writeFile(replacementPath, "{}\n")]);
    const registry = durableRegistry(root, "host-a", 1);
    const observer = durableRegistry(root, "host-b", 2);
    const active = await registry.reserve("task-a", activePath);
    await registry.commit(active, activePath);
    const replacement = await registry.reserve("task-a", replacementPath);
    await registry.cancel(replacement);

    expect(registry.activeIdentityFor("task-a")).toBeDefined();
    await expect(observer.reserve("task-b", activePath)).rejects.toMatchObject({ code: "BUSY" });
    await expect(observer.reserve("task-b", replacementPath)).resolves.toBeDefined();
  });

  it("releases the old lease only after a replacement commit", async () => {
    const root = await temporaryRoot("pi67-session-writer-replacement-commit-");
    const activePath = join(root, "active.jsonl");
    const replacementPath = join(root, "replacement.jsonl");
    await Promise.all([writeFile(activePath, "{}\n"), writeFile(replacementPath, "{}\n")]);
    const registry = durableRegistry(root, "host-a", 1);
    const observer = durableRegistry(root, "host-b", 2);
    const active = await registry.reserve("task-a", activePath);
    await registry.commit(active, activePath);
    const replacement = await registry.reserve("task-a", replacementPath);

    await expect(observer.reserve("task-b", activePath)).rejects.toMatchObject({ code: "BUSY" });
    await registry.commit(replacement, replacementPath);
    await expect(observer.reserve("task-b", activePath)).resolves.toBeDefined();
    await expect(observer.reserve("task-c", replacementPath)).rejects.toMatchObject({ code: "BUSY" });
  });

  it("rekeys a pending path to physical identity before releasing its provisional fence", async () => {
    const root = await temporaryRoot("pi67-session-writer-pending-rekey-");
    const session = join(root, "new-session.jsonl");
    const alias = join(root, "new-session-alias.jsonl");
    const registry = durableRegistry(root, "host-a", 1);
    const observer = durableRegistry(root, "host-b", 2);
    const pending = await registry.reserve("task-a", session);
    await writeFile(session, "{}\n");
    await link(session, alias);
    await registry.commit(pending, session);

    await expect(observer.reserve("task-b", alias))
      .rejects.toMatchObject({ code: "BUSY", details: { sessionWriterLeaseConflict: true } });
  });

  it("rejects a second writer through a hard-linked JSONL alias", async () => {
    const root = await temporaryRoot("pi67-session-writer-hardlink-");
    const session = join(root, "session.jsonl");
    const alias = join(root, "session-alias.jsonl");
    await writeFile(session, "{}\n");
    await link(session, alias);
    const registry = track(new SessionWriterLeaseRegistry());
    const first = await registry.reserve("task-a", session);
    await registry.commit(first, session);

    await expect(registry.reserve("task-b", alias))
      .rejects.toMatchObject({ code: "BUSY", details: { sessionWriterLeaseConflict: true } });
  });

  it("keeps a pending parent-and-leaf fence after the JSONL appears", async () => {
    const root = await temporaryRoot("pi67-session-writer-pending-");
    const session = join(root, "new-session.jsonl");
    const registry = track(new SessionWriterLeaseRegistry());
    const pending = await registry.reserve("task-a", session);
    await writeFile(session, "{}\n");

    await expect(registry.reserve("task-b", session))
      .rejects.toMatchObject({ code: "BUSY", details: { sessionWriterLeaseConflict: true } });
    await registry.cancel(pending);
  });

  it("does not lowercase distinct pending leaf names", async () => {
    const root = await temporaryRoot("pi67-session-writer-case-");
    const registry = track(new SessionWriterLeaseRegistry());

    await expect(registry.reserve("task-upper", join(root, "Session.JSONL"))).resolves.toBeDefined();
    await expect(registry.reserve("task-lower", join(root, "session.jsonl"))).resolves.toBeDefined();
  });

  it("fails closed while a durable lock is live and recovers only after it is stale", async () => {
    const root = await temporaryRoot("pi67-session-writer-stale-");
    const identity = "physical-session-stale";
    const metadataPath = sessionWriterLeaseMetadataPath(root, hashPrivateValue(identity));
    const lockPath = `${metadataPath}.lock`;
    await mkdir(lockPath, { recursive: true });
    const registry = track(new SessionWriterLeaseRegistry({
      storageRoot: root,
      canonicalize: async () => identity,
      staleMs: 2_000,
      updateMs: 1_000,
      metadataHeartbeatMs: 1_000,
      getOwnerIdentity: () => owner("host-new", 2)
    }));

    await expect(registry.reserve("task-new", "/private/session.jsonl"))
      .rejects.toMatchObject({ code: "BUSY" });
    const staleAt = new Date(Date.now() - 10_000);
    await utimes(lockPath, staleAt, staleAt);
    await expect(registry.reserve("task-new", "/private/session.jsonl")).resolves.toBeDefined();
  });

  it("reclaims a fresh durable lock only after proving its owner process exited", async () => {
    const root = await temporaryRoot("pi67-session-writer-dead-owner-");
    const identity = "physical-session-dead-owner";
    const identityHash = hashPrivateValue(identity);
    const metadataPath = sessionWriterLeaseMetadataPath(root, identityHash);
    const deadProcessId = 424_242;
    await mkdir(`${metadataPath}.lock`, { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify({
      version: 1,
      token: "session-lease-dead",
      appInstanceId: "app-old",
      hostInstanceId: "host-old",
      hostEpoch: 1,
      processId: deadProcessId,
      taskKeyHash: hashPrivateValue("workspace-old/task-old"),
      sessionIdentityHash: identityHash,
      acquiredAt: Date.now(),
      heartbeatAt: Date.now()
    })}\n`);
    const firstRegistry = track(new SessionWriterLeaseRegistry({
      ...durableOptions(root, "host-new-a", 2),
      canonicalize: async () => identity,
      isProcessAlive: (processId) => processId !== deadProcessId
    }));
    const secondRegistry = track(new SessionWriterLeaseRegistry({
      ...durableOptions(root, "host-new-b", 3),
      canonicalize: async () => identity,
      isProcessAlive: (processId) => processId !== deadProcessId
    }));

    const outcomes = await Promise.allSettled([
      firstRegistry.reserve("task-new-a", "/private/session.jsonl"),
      secondRegistry.reserve("task-new-b", "/private/session.jsonl")
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "BUSY" }) })
    ]);
  });

  it("does not reclaim a fresh durable lock when owner liveness is unknown", async () => {
    const root = await temporaryRoot("pi67-session-writer-live-owner-");
    const identity = "physical-session-live-owner";
    const identityHash = hashPrivateValue(identity);
    const metadataPath = sessionWriterLeaseMetadataPath(root, identityHash);
    await mkdir(`${metadataPath}.lock`, { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify({
      version: 1,
      token: "session-lease-live",
      appInstanceId: "app-old",
      hostInstanceId: "host-old",
      hostEpoch: 1,
      processId: 515_151,
      taskKeyHash: hashPrivateValue("workspace-old/task-old"),
      sessionIdentityHash: identityHash,
      acquiredAt: Date.now(),
      heartbeatAt: Date.now()
    })}\n`);
    const registry = track(new SessionWriterLeaseRegistry({
      ...durableOptions(root, "host-new", 2),
      canonicalize: async () => identity,
      isProcessAlive: () => true
    }));

    await expect(registry.reserve("task-new", "/private/session.jsonl"))
      .rejects.toMatchObject({ code: "BUSY" });
  });

  it("persists bounded owner metadata without paths or task identifiers", async () => {
    const root = await temporaryRoot("pi67-session-writer-metadata-");
    const rawPath = join(root, "private-project", "session.jsonl");
    const taskKey = "workspace-secret/task-secret";
    const identity = "physical-private-session";
    const registry = track(new SessionWriterLeaseRegistry({
      storageRoot: root,
      canonicalize: async () => identity,
      getOwnerIdentity: () => owner("host-safe", 7)
    }));
    await registry.reserve(taskKey, rawPath);
    const metadataPath = sessionWriterLeaseMetadataPath(root, hashPrivateValue(identity));
    const metadataText = await readFile(metadataPath, "utf8");
    const metadata = JSON.parse(metadataText) as Record<string, unknown>;

    expect(Object.keys(metadata).sort()).toEqual([
      "acquiredAt",
      "appInstanceId",
      "heartbeatAt",
      "hostEpoch",
      "hostInstanceId",
      "processId",
      "sessionIdentityHash",
      "taskKeyHash",
      "token",
      "version"
    ]);
    expect(metadataText).not.toContain(rawPath);
    expect(metadataText).not.toContain(taskKey);
    expect(metadataText).not.toContain(identity);
    expect(metadata.sessionIdentityHash).toBe(hashPrivateValue(identity));
    expect(metadata.taskKeyHash).toBe(hashPrivateValue(taskKey));
  });
});

function track(registry: SessionWriterLeaseRegistry): SessionWriterLeaseRegistry {
  registries.push(registry);
  return registry;
}

function durableRegistry(
  storageRoot: string,
  hostInstanceId: string,
  hostEpoch: number
): SessionWriterLeaseRegistry {
  return track(new SessionWriterLeaseRegistry(durableOptions(
    storageRoot,
    hostInstanceId,
    hostEpoch
  )));
}

function durableOptions(
  storageRoot: string,
  hostInstanceId: string,
  hostEpoch: number
) {
  return {
    storageRoot,
    staleMs: 2_000,
    updateMs: 1_000,
    metadataHeartbeatMs: 1_000,
    getOwnerIdentity: () => owner(hostInstanceId, hostEpoch)
  };
}

function owner(hostInstanceId: string, hostEpoch: number) {
  return {
    appInstanceId: "app-test",
    hostInstanceId,
    hostEpoch,
    processId: process.pid
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
