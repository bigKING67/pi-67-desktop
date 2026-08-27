import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  commitFromGitRefOutput,
  compareStableVersions,
  createCapabilityFreshnessReport,
  latestStableReleaseFromGitOutput
} from "./check-capability-freshness.mjs";

const CURRENT_COMMIT = "1".repeat(40);
const LATEST_COMMIT = "2".repeat(40);
const TAG_OBJECT = "3".repeat(40);

describe("first-party capability freshness", () => {
  it("selects the highest stable tag and resolves annotated tags to their peeled commit", () => {
    const output = [
      `${CURRENT_COMMIT}\trefs/tags/v1.4.0`,
      `${TAG_OBJECT}\trefs/tags/v1.5.0`,
      `${LATEST_COMMIT}\trefs/tags/v1.5.0^{}`,
      `${"4".repeat(40)}\trefs/tags/v1.6.0-beta.1`,
      `${"5".repeat(40)}\trefs/tags/not-a-version`
    ].join("\n");

    expect(latestStableReleaseFromGitOutput(output)).toEqual({
      version: "1.5.0",
      tag: "v1.5.0",
      commit: LATEST_COMMIT
    });
  });

  it("compares stable versions numerically instead of lexically", () => {
    expect(compareStableVersions("2.10.0", "2.9.9")).toBe(1);
    expect(compareStableVersions("2.2.0", "2.2.0")).toBe(0);
    expect(compareStableVersions("0.15.7", "0.15.8")).toBe(-1);
  });

  it("reports current, stale, ahead, and unreachable sources without losing the full report", async () => {
    const lock = fixtureLock();
    const report = await createCapabilityFreshnessReport({
      lock,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      resolveLatest: async (repository) => {
        if (repository.endsWith("/current.git")) {
          return { version: "1.0.0", tag: "v1.0.0", commit: CURRENT_COMMIT };
        }
        if (repository.endsWith("/stale.git")) {
          return { version: "2.2.0", tag: "v2.2.0", commit: LATEST_COMMIT };
        }
        if (repository.endsWith("/ahead.git")) {
          return { version: "2.0.0", tag: "v2.0.0", commit: LATEST_COMMIT };
        }
        throw new Error(`network failed\n${"x".repeat(600)}`);
      },
      resolveRef: async () => CURRENT_COMMIT
    });

    expect(report).toMatchObject({
      generatedAt: "2026-07-30T12:00:00.000Z",
      catalogVersion: "2026.07.30.1",
      status: "failed",
      statuses: { ahead: 1, current: 2, stale: 1, unreachable: 1 }
    });
    expect(report.sources.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "current", status: "current" },
      { id: "stale", status: "stale" },
      { id: "ahead", status: "ahead" },
      { id: "offline", status: "unreachable" }
    ]);
    expect(report.sources[3].error).not.toContain("\n");
    expect(report.sources[3].error.length).toBeLessThanOrEqual(500);
    expect(report.skillPacks).toEqual([{
      name: "ai-berkshire-investment-suite",
      repository: "https://github.com/example/ai-berkshire.git",
      ref: "refs/heads/main",
      lockedVersion: "1.0.1",
      lockedCommit: CURRENT_COMMIT,
      latestCommit: CURRENT_COMMIT,
      status: "current"
    }]);
  });

  it("parses one exact tracked branch ref and detects a newer Skill Pack commit", async () => {
    expect(commitFromGitRefOutput(
      `${LATEST_COMMIT}\trefs/heads/main\n`,
      "refs/heads/main"
    )).toBe(LATEST_COMMIT);
    expect(() => commitFromGitRefOutput("", "refs/heads/main")).toThrow(/did not resolve/u);

    const lock = fixtureLock();
    const report = await createCapabilityFreshnessReport({
      lock,
      resolveLatest: async (repository) => ({
        version: lock.sources.find((source) => source.repository === repository).version,
        tag: "v1.0.0",
        commit: LATEST_COMMIT
      }),
      resolveRef: async () => LATEST_COMMIT
    });
    expect(report.sources.every((source) => source.status === "current")).toBe(true);
    expect(report.skillPacks[0].status).toBe("stale");
    expect(report.status).toBe("failed");
  });

  it("requires branch-tracked first-party sources to match the exact remote commit", async () => {
    const lock = fixtureLock();
    lock.sources[0].ref = "refs/heads/main";
    const report = await createCapabilityFreshnessReport({
      lock,
      resolveLatest: async (repository) => ({
        version: lock.sources.find((source) => source.repository === repository).version,
        tag: "v1.0.0",
        commit: CURRENT_COMMIT
      }),
      resolveRef: async (repository) => repository.endsWith("/current.git") ? LATEST_COMMIT : CURRENT_COMMIT
    });

    expect(report.sources[0]).toMatchObject({
      id: "current",
      ref: "refs/heads/main",
      lockedCommit: CURRENT_COMMIT,
      latestCommit: LATEST_COMMIT,
      status: "stale"
    });
  });

  it("rejects ambiguous stable tag aliases that resolve to different commits", () => {
    const output = [
      `${CURRENT_COMMIT}\trefs/tags/1.0.0`,
      `${LATEST_COMMIT}\trefs/tags/v1.0.0`
    ].join("\n");
    expect(() => latestStableReleaseFromGitOutput(output)).toThrow(/multiple commits/u);
  });

  it("keeps scheduled and release-time freshness checks read-only and dependency-free", async () => {
    const workflow = await readFile(new URL(
      "../../.github/workflows/capability-freshness.yml",
      import.meta.url
    ), "utf8");
    const release = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    const candidate = await readFile(new URL("../../.github/workflows/windows-candidate.yml", import.meta.url), "utf8");
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("node-version: 24.18.0");
    expect(workflow).toContain("node eng/capabilities/check-capability-freshness.mjs --json");
    expect(workflow).toContain("artifacts/quality/capability-freshness.json");
    expect(workflow).not.toContain("pnpm install");
    expect(release).toContain("Verify first-party capability freshness");
    expect(release).toContain("capability-freshness-signed-release-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(candidate).toContain("Verify first-party capability freshness");
    expect(candidate).toContain("capability-freshness-windows-candidate-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(packageJson.scripts["check:capability-freshness"])
      .toBe("node eng/capabilities/check-capability-freshness.mjs");
  });
});

function fixtureLock() {
  return {
    schema: "pi67.capability-sources-lock.v1",
    catalogVersion: "2026.07.30.1",
    sources: [
      source("current", "1.0.0"),
      source("stale", "2.0.0"),
      source("ahead", "3.0.0"),
      source("offline", "1.0.0")
    ],
    skillPacks: [skillPackSource()]
  };
}

function source(id, version) {
  return {
    id,
    repository: `https://github.com/example/${id}.git`,
    commit: CURRENT_COMMIT,
    version
  };
}

function skillPackSource() {
  return {
    name: "ai-berkshire-investment-suite",
    adapter: "pi67-ai-berkshire-v1",
    adapterSourceId: "pi67-core",
    repository: "https://github.com/example/ai-berkshire.git",
    ref: "refs/heads/main",
    commit: CURRENT_COMMIT,
    version: "1.0.1",
    manifestSha256: "4".repeat(64),
    bundleSha256: "5".repeat(64),
    skills: [{ name: "investment-research", sha256: "6".repeat(64) }]
  };
}
