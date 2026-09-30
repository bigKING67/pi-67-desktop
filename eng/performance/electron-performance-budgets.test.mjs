import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { writeElectronPerformanceReport } from "./electron-performance-report.mjs";
import {
  RENDERER_ASSET_RATCHETS,
  rendererAssetRatchetBudget
} from "./electron-renderer-performance-metrics.mjs";

// The report reads package.json and Git state from the repository root; output stays temporary.
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { force: true, recursive: true }); });

async function reportFor(overrides) {
  const directory = await mkdtemp(join(tmpdir(), "pi67-electron-budgets-"));
  directories.push(directory);
  const outputPath = join(directory, "electron.json");
  const transitions = [{ welcome: [], agentConnection: [], runtimeInitialization: [], sessionRestore: [] }];
  const samples = new Proxy({ rendererResourceTransitions: transitions, ...overrides }, {
    get: (target, key) => (key in target ? target[key] : [10])
  });
  let error;
  try {
    await writeElectronPerformanceReport({ root: repositoryRoot, outputPath, platform: "darwin", defaultMessagePageSize: 100, samples });
  } catch (caught) { error = caught; }
  const report = JSON.parse(await readFile(outputPath, "utf8"));
  return { error, verdict: report.verdict, metric: (id) => report.metrics.find((entry) => entry.id === id) };
}

describe("Electron performance budgets", () => {
  it("treats renderer asset bytes as a 5% ratchet over the accepted baseline", () => {
    expect(rendererAssetRatchetBudget({ baselineMiB: 0.638, tolerance: 0.05 })).toBe(0.67);
    for (const ratchet of Object.values(RENDERER_ASSET_RATCHETS)) expect(ratchet.tolerance).toBe(0.05);
  });

  it("budgets user outcomes and owned memory, not summed resident working sets", async () => {
    const { error, metric, verdict } = await reportFor({ welcomeMemory: [400], welcomeOwnedMemory: [150], runtimeInitialization: [900] });
    expect(error).toBeUndefined();
    expect(verdict).toBe("pass");
    expect(metric("welcomeIdleWorkingSet")).toMatchObject({ status: "informational" });
    expect(metric("welcomeIdleWorkingSet").budget).toBeUndefined();
    expect(metric("welcomeOwnedMemory")).toMatchObject({ budget: 160, status: "pass" });
    expect(metric("runtimeInitialization")).toMatchObject({ budget: 1_200, status: "pass" });
  });

  // PI67_PERF_ENFORCE=1 turns a failed verdict into a thrown gate failure.
  it("fails the verdict when owned Welcome memory or Runtime initialization regresses", async () => {
    const memory = await reportFor({ welcomeOwnedMemory: [161] });
    expect(memory.metric("welcomeOwnedMemory").status).toBe("fail");
    expect(memory.verdict).toBe("fail");
    const runtime = await reportFor({ runtimeInitialization: [1_201] });
    expect(runtime.metric("runtimeInitialization").status).toBe("fail");
    expect(runtime.verdict).toBe("fail");
  });
});
