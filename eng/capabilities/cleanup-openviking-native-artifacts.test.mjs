import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyOpenVikingNativeCleanup,
  parseOpenVikingNativeCleanupArguments,
  planOpenVikingNativeCleanup
} from "./cleanup-openviking-native-artifacts.mjs";
import { runNativeArtifact } from "./native-artifact-store.mjs";

const roots = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { force: true, recursive: true }); });

describe("OpenViking native artifact cleanup", () => {
  it("plans only a preparation with an identical ready signed runtime", async () => {
    const fixture = await artifactFixture();
    const plan = await planOpenVikingNativeCleanup({ probeInUse: async () => false, root: fixture.root });

    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ treeSha256: fixture.matchingTree });
    expect(plan.targets[0].payloads.map(payload => payload.relativePath)).toEqual([
      expect.stringContaining("preparation-")
    ]);
    expect(plan.protectedArtifacts.map(artifact => artifact.reason)).toEqual(["CURRENT_SIGNED_RUNTIME", "CURRENT_SIGNED_RUNTIME"]);
    expect(plan.retainedPreparations).toEqual([
      expect.objectContaining({ reason: "NO_VERIFIED_SIGNED_MATCH" })
    ]);
    expect(plan.bytes).toBeGreaterThan(0);
  });

  it("requires exact confirmation, validates before retirement, and preserves evidence and signed bytes", async () => {
    const fixture = await artifactFixture();
    const validateTarget = vi.fn(async target => {
      expect(target.treeSha256).toBe(fixture.matchingTree);
      expect(await readFile(join(target.preparedRuntime, "payload"), "utf8")).toBe("same-runtime");
    });

    await expect(applyOpenVikingNativeCleanup({ root: fixture.root })).rejects.toThrow("requires --confirm");
    const result = await applyOpenVikingNativeCleanup({
      confirmed: true,
      probeInUse: async () => false,
      root: fixture.root,
      validateTarget
    });

    expect(validateTarget).toHaveBeenCalledTimes(1);
    expect(result.removed).toHaveLength(1);
    await expect(access(fixture.preparedRuntime)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(fixture.preparationPath, "receipt.json"), "utf8")).resolves.toBe("evidence");
    await expect(readFile(join(fixture.signedPath, "runtime/payload"), "utf8")).resolves.toBe("same-runtime");
    const marker = JSON.parse(await readFile(join(fixture.preparationPath, "native-artifact.json"), "utf8"));
    expect(marker.status).toBe("RETIRED");
    expect(result.after.targets).toEqual([]);
  });

  it("retires only an older same-purpose signed runtime and keeps the newest one", async () => {
    const fixture = await artifactFixture();
    const parent = join(fixture.root, "artifacts/openviking-native");
    const older = await createArtifact(parent, "signed", "private", createHash("sha256").update("older").digest("hex"), "runtime", "older-runtime");
    await rewriteRecord(older.path, { createdAt: "2000-01-01T00:00:00.000Z" });

    const plan = await planOpenVikingNativeCleanup({ probeInUse: async () => false, root: fixture.root });
    const superseded = plan.targets.filter(target => target.kind === "superseded-signed");
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({ treeSha256: fixture.matchingTree });
    expect(superseded[0].artifact.path).toBe(older.path);
    expect(superseded[0].replacementInstallation).toBe(fixture.signedPath);
    expect(plan.protectedArtifacts).toContainEqual(expect.objectContaining({ reason: "CURRENT_SIGNED_RUNTIME" }));

    await writeFile(join(older.path, ".keep"), "keep");
    const pinnedPlan = await planOpenVikingNativeCleanup({ probeInUse: async () => false, root: fixture.root });
    expect(pinnedPlan.targets.filter(target => target.kind === "superseded-signed")).toEqual([]);
    expect(pinnedPlan.protectedArtifacts).toContainEqual(expect.objectContaining({ reason: "PINNED_SIGNED_RUNTIME" }));
  });

  it("retires a failed attempt only after a later successful same-purpose preparation", async () => {
    const fixture = await artifactFixture();
    const parent = join(fixture.root, "artifacts/openviking-native");
    const earlier = await createArtifact(parent, "preparation", "private-query-coalescing-v1", createHash("sha256").update("earlier").digest("hex"), "staging", "partial");
    await rewriteRecord(earlier.path, { createdAt: "2000-01-01T00:00:00.000Z", status: "FAILED" });
    const later = await createArtifact(parent, "preparation", "private-query-coalescing-v1", createHash("sha256").update("later").digest("hex"), "staging", "partial");
    await rewriteRecord(later.path, { createdAt: "2999-01-01T00:00:00.000Z", status: "FAILED" });

    const plan = await planOpenVikingNativeCleanup({ probeInUse: async () => false, root: fixture.root });
    const superseded = plan.targets.filter(target => target.kind === "superseded-failure");
    expect(superseded.map(target => target.artifact.path)).toEqual([earlier.path]);
    expect(superseded[0]).toMatchObject({ replacementInstallation: fixture.signedPath, treeSha256: fixture.matchingTree });
    expect(plan.protectedArtifacts).toContainEqual({
      reason: "DIAGNOSTIC_FAILURE",
      relativePath: relative(fixture.root, later.path)
    });
  });

  it("preserves pinned or busy preparations and never follows a payload symlink", async () => {
    const pinned = await artifactFixture();
    await writeFile(join(pinned.preparationPath, ".keep"), "keep");
    expect((await planOpenVikingNativeCleanup({ probeInUse: async () => false, root: pinned.root })).targets).toEqual([]);

    const busy = await artifactFixture();
    const busyPlan = await planOpenVikingNativeCleanup({ probeInUse: async path => path === busy.preparationPath, root: busy.root });
    expect(busyPlan.targets).toEqual([]);
    expect(busyPlan.retainedPreparations).toContainEqual(expect.objectContaining({ reason: "IN_USE" }));

    const linked = await artifactFixture();
    const outside = join(linked.root, "outside");
    await mkdir(outside); await writeFile(join(outside, "keep"), "protected");
    await rm(linked.preparedRuntime, { recursive: true });
    await symlink(outside, linked.preparedRuntime);
    await expect(planOpenVikingNativeCleanup({ probeInUse: async () => false, root: linked.root }))
      .rejects.toThrow("no safe source runtime");
    await expect(readFile(join(outside, "keep"), "utf8")).resolves.toBe("protected");
  });

  it("accepts only the bounded CLI contract", () => {
    expect(parseOpenVikingNativeCleanupArguments([])).toEqual({ confirmed: false, mode: "plan" });
    expect(parseOpenVikingNativeCleanupArguments(["plan"])).toEqual({ confirmed: false, mode: "plan" });
    expect(parseOpenVikingNativeCleanupArguments(["apply", "--confirm-openviking-native-cleanup"]))
      .toEqual({ confirmed: true, mode: "apply" });
    expect(parseOpenVikingNativeCleanupArguments(["--", "apply", "--confirm-openviking-native-cleanup"]))
      .toEqual({ confirmed: true, mode: "apply" });
    expect(() => parseOpenVikingNativeCleanupArguments(["apply"])).toThrow("Usage");
    expect(() => parseOpenVikingNativeCleanupArguments(["apply", "--force"])).toThrow("Usage");
  });
});

async function artifactFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openviking-cleanup-"))); roots.push(root);
  const parent = join(root, "artifacts/openviking-native"); await mkdir(parent, { recursive: true });
  const matchingTree = createHash("sha256").update("matching").digest("hex");
  const otherTree = createHash("sha256").update("other").digest("hex");
  const preparation = await createArtifact(parent, "preparation", "private-query-coalescing-v1", matchingTree, "New Money 本地运行包", "same-runtime");
  await writeFile(join(preparation.path, "receipt.json"), "evidence");
  await createArtifact(parent, "preparation", "team-index-v1", otherTree, "New Money 本地运行包", "other-runtime");
  const signed = await createArtifact(parent, "signed", "private", matchingTree, "runtime", "same-runtime");
  await createArtifact(parent, "signed", "team-query-v1", createHash("sha256").update("query").digest("hex"), "runtime", "query-runtime");
  return {
    matchingTree,
    preparationPath: preparation.path,
    preparedRuntime: join(preparation.path, "New Money 本地运行包"),
    root,
    signedPath: signed.path
  };
}

async function createArtifact(parent, kind, purpose, treeSha256, payloadName, payload) {
  let artifactPath;
  const result = await runNativeArtifact({
    build: async path => {
      artifactPath = path;
      await mkdir(join(path, payloadName)); await writeFile(join(path, payloadName, "payload"), payload);
      return { tree: { bytes: Buffer.byteLength(payload), files: 1, sha256: treeSha256 } };
    },
    key: createHash("sha256").update(`${kind}:${purpose}:${treeSha256}`).digest("hex"),
    kind,
    parent,
    probeInUse: async () => false,
    purpose,
    report: () => {},
    validate: async () => {}
  });
  return { ...result, path: artifactPath };
}

async function rewriteRecord(artifactPath, patch) {
  const recordPath = join(artifactPath, "native-artifact.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  await writeFile(recordPath, JSON.stringify({ ...record, ...patch }, null, 2));
}
