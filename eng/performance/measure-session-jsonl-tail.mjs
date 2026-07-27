import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS,
  runSessionJsonlTailPerformanceSample
} from "../../packages/pi-runtime/eng/session-jsonl-tail-performance-fixture.mjs";
import { resolveSampleCount } from "./performance-contract.mjs";
import { writeSessionJsonlTailPerformanceReport } from "./session-jsonl-tail-performance-report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sampleCount = resolveSampleCount();
const boundarySampleCount = resolveBoundarySampleCount(sampleCount);
const outputPath = process.env.PI67_PERF_SESSION_JSONL_TAIL_OUTPUT
  ?? join(root, "artifacts/performance", `session-jsonl-tail-${process.platform}-${process.arch}.json`);
const samples = createSamples();

for (let index = 0; index < sampleCount; index += 1) {
  const result = await runSessionJsonlTailPerformanceSample({ includeBoundary: index < boundarySampleCount });
  pushScenario(samples, "selfAppend1KiB", result.selfAppend1KiB);
  pushScenario(samples, "selfAppend256KiB", result.selfAppend256KiB);
  pushScenario(samples, "boundedDrain4MiB", result.boundedDrain4MiB);
  pushScenario(samples, "sequentialSelfAppend1000", result.sequentialSelfAppend1000);
  pushScenario(samples, "externalAppend", result.externalAppend);
  pushScenario(samples, "truncate", result.truncate);
  pushScenario(samples, "atomicReplace", result.atomicReplace);
  pushScenario(samples, "missingCreate", result.missingCreate);
  pushScenario(samples, "generationDisposeRace", result.generationDisposeRace);
  if (result.boundary64MiB) pushScenario(samples, "boundary64MiB", result.boundary64MiB);
}

await writeSessionJsonlTailPerformanceReport({
  root,
  outputPath,
  samples,
  workloads: SESSION_JSONL_TAIL_PERFORMANCE_WORKLOADS,
  boundarySampleCount
});

function createSamples() {
  const scenarios = [
    "selfAppend1KiB",
    "selfAppend256KiB",
    "boundedDrain4MiB",
    "boundary64MiB",
    "sequentialSelfAppend1000",
    "externalAppend",
    "truncate",
    "atomicReplace",
    "missingCreate",
    "generationDisposeRace"
  ];
  const fields = [
    "durationMs",
    "bytesProcessed",
    "recordsProcessed",
    "passCount",
    "peakPendingLineBytes",
    "eventLoopYieldCount"
  ];
  return Object.fromEntries(scenarios.flatMap((scenario) => (
    fields.map((field) => [`${scenario}${capitalize(field)}`, []])
  )));
}

function pushScenario(samples, scenario, result) {
  for (const [field, value] of Object.entries(result)) {
    const target = samples[`${scenario}${capitalize(field)}`];
    if (!target) throw new Error(`Unknown Session JSONL tail performance field: ${scenario}.${field}`);
    target.push(value);
  }
}

function resolveBoundarySampleCount(totalSampleCount) {
  const raw = process.env.PI67_PERF_JSONL_BOUNDARY_SAMPLES ?? String(Math.min(totalSampleCount, 3));
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > totalSampleCount) {
    throw new Error("PI67_PERF_JSONL_BOUNDARY_SAMPLES must be an integer from 1 to PI67_PERF_SAMPLES.");
  }
  return value;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
