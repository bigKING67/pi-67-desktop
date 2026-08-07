import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLargeSessionJsonlPerformanceSample } from "../../packages/pi-runtime/eng/session-large-jsonl-performance-fixture.mjs";
import {
  resolveLargeSessionJsonlProfile,
  resolveLargeSessionJsonlSampleCount
} from "./large-session-jsonl-contract.mjs";
import { writeLargeSessionJsonlPerformanceReport } from "./large-session-jsonl-performance-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const profile = resolveLargeSessionJsonlProfile();
const sampleCount = resolveLargeSessionJsonlSampleCount();
const outputPath = process.env.PI67_PERF_LARGE_SESSION_OUTPUT
  ?? join(root, "artifacts/performance", `large-session-jsonl-${profile.id}-${process.platform}-${process.arch}.json`);
const samples = Object.fromEntries(profile.workloads.map((workload) => [workload.id, createSamples()]));

for (let sample = 0; sample < sampleCount; sample += 1) {
  for (const workload of profile.workloads) {
    console.log(`Large Session JSONL ${workload.label} sample ${sample + 1}/${sampleCount}: start`);
    const result = await runLargeSessionJsonlPerformanceSample(workload);
    const target = samples[workload.id];
    for (const field of Object.keys(target)) target[field].push(result[field]);
    console.log(`Large Session JSONL ${workload.label} sample ${sample + 1}/${sampleCount}: complete`);
  }
}

await writeLargeSessionJsonlPerformanceReport({
  root,
  outputPath,
  profile: profile.id,
  workloads: profile.workloads,
  samples
});

function createSamples() {
  return {
    durationMs: [],
    fixtureWriteMs: [],
    bytesProcessed: [],
    recordsProcessed: [],
    passCount: [],
    peakPendingLineBytes: [],
    eventLoopYieldCount: []
  };
}
