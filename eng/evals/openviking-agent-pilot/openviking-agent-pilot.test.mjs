import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertArtifactSafe } from "./artifact-safety.mjs";
import { inspectAgentPilotAssembly } from "./agent-runtime.mjs";
import { agentRunCount, expectedForTurn, loadAgentPilotCorpus } from "./corpus.mjs";
import { percentile, smokeGate, summarizeAgentResults } from "./metrics.mjs";
import { readPilotCredentials } from "./provider-config.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("OpenViking task-level Agent pilot", () => {
  it("freezes a 54-run matrix and creates run-specific evidence codes", () => {
    const first = loadAgentPilotCorpus("run-a");
    const second = loadAgentPilotCorpus("run-b");
    expect(agentRunCount(first)).toBe(54);
    expect(first.scenarios.limits.modelMaxOutputTokens).toBe(1024);
    expect(first.scenarios.scenarios).toHaveLength(6);
    expect(first.documents).toHaveLength(8);
    expect(first.documents.map((document) => document.id)).toEqual([
      "mac-host-epoch-recovery",
      "extension-ui-epoch-cancel",
      "openviking-owner-conflict",
      "shared-experience-revoke",
      "windows-chinese-path-doctor",
      "paid-live-no-conversion",
      "product-card-low-cvr",
      "short-video-hook",
    ]);
    const turn = first.scenarios.scenarios[0].turns[0];
    expect(expectedForTurn(turn, first.evidenceCodes)).toMatch(/^PX-[0-9A-F]{12}$/u);
    expect(expectedForTurn(turn, first.evidenceCodes)).not.toBe(expectedForTurn(turn, second.evidenceCodes));
  });

  it("requires the candidate to solve both task-switch Turns through viking_search", () => {
    const results = [
      result("no-memory", 0, {}),
      result("official-context", 2, {}),
      result("pi67-find-only", 2, { viking_search: 1, viking_read: 1 }),
    ];
    expect(smokeGate(results)).toEqual({
      pass: true,
      checks: {
        runFailures: true,
        credentialLiterals: true,
        providerRequestsBounded: true,
        officialTaskSwitchSuccess: true,
        candidateTaskSwitchSuccess: true,
        candidateUsedSearchAfterSwitch: true,
        isolatedRuntimeCleanup: true,
      },
    });
    results[2].toolCalls = {};
    expect(smokeGate(results).pass).toBe(false);
  });

  it("aggregates task, control, Tool, latency, request, and Token evidence", () => {
    const values = [
      { ...result("pi67-find-only", 1, { viking_search: 1 }), scenarioKind: "memory-required", latencyMs: 100 },
      { ...result("pi67-find-only", 1, {}), scenarioKind: "control", latencyMs: 400 },
    ];
    const summary = summarizeAgentResults(values)[0];
    expect(summary).toMatchObject({
      taskSuccessRate: 0.5,
      controlSuccessRate: 0.5,
      providerRequests: 4,
      openVikingRequests: 4,
      latencyP50Ms: 100,
      latencyP95Ms: 400,
      controlOpenVikingRequests: 2,
    });
    expect(percentile([400, 100, 200], 0.5)).toBe(200);
  });

  it("reads a mode-0600 external Provider config without including keys in public metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-agent-provider-"));
    temporaryDirectories.push(root);
    const path = join(root, "ov.conf");
    await writeFile(path, JSON.stringify({
      server: { root_api_key: "root-fixture-secret" },
      vlm: {
        api_key: "provider-fixture-secret",
        api_base: "https://provider.example/api/v3",
        model: "fixture-model",
      },
    }));
    await chmod(path, 0o600);
    const config = readPilotCredentials(path);
    expect(config.public).toEqual({
      fileMode: "0600",
      providerBaseUrl: "https://provider.example/api/v3",
      modelId: "fixture-model",
      protocol: "openai-completions",
    });
    expect(JSON.stringify(config.public)).not.toContain("fixture-secret");
  });

  it("rejects secrets, credential shapes, and raw model content from evidence", () => {
    expect(() => assertArtifactSafe({ model: "safe" }, { provider: "secret-value" })).not.toThrow();
    expect(() => assertArtifactSafe({ value: "secret-value" }, { provider: "secret-value" }))
      .toThrow("credential_in_artifact");
    expect(() => assertArtifactSafe({ value: "Bearer abcdefghijklmnop" })).toThrow("credential_shape_in_artifact");
    expect(() => assertArtifactSafe({ prompt: "raw" })).toThrow("raw_model_content_in_artifact");
  });

  it("loads the evaluation Package and fixed model through the real Pi ResourceLoader", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-agent-assembly-"));
    temporaryDirectories.push(root);
    const assembly = await inspectAgentPilotAssembly({
      isolationRoot: root,
      provider: {
        providerBaseUrl: "https://provider.example/api/v3",
        modelId: "fixture-model",
        protocol: "openai-completions",
      },
      limits: { modelMaxOutputTokens: 1024 },
      openVikingBaseUrl: "http://127.0.0.1:1933",
    });
    expect(assembly).toEqual({
      extensionLoaded: true,
      extensionCatalogItems: 1,
      modelLoaded: true,
    });
  });
});

function result(profile, successfulTurns, toolCalls) {
  return {
    profile,
    scenarioId: "material-task-switch",
    scenarioKind: "task-switch",
    repetition: 1,
    sequence: 1,
    status: "pass",
    turns: [{ latencyMs: 100 }, { latencyMs: 100 }],
    successfulTurns,
    totalTurns: 2,
    toolCalls,
    providerRequests: 2,
    openVikingRequests: 2,
    openVikingPaths: {},
    latencyMs: 200,
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: 0, assistantMessages: 2 },
    credentialLiteralMatches: 0,
    isolatedRuntimeDeleted: true,
  };
}
