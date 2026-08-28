import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeSyntheticSessionOpenFixture } from "../../packages/pi-runtime/eng/session-open-performance-fixture.mjs";
import {
  resolveSessionOpenProfile,
  resolveSessionOpenSampleCount
} from "./session-open-contract.mjs";
import { writeSessionOpenPerformanceReport } from "./session-open-performance-report.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const childPath = fileURLToPath(new URL("./session-open-sample-child.mjs", import.meta.url));
const profile = resolveSessionOpenProfile();
const sampleCount = resolveSessionOpenSampleCount(profile);
const outputPath = process.env.PI67_PERF_SESSION_OPEN_OUTPUT
  ?? join(root, "artifacts/performance", `session-open-${profile.id}-${process.platform}-${process.arch}.json`);
const samples = Object.fromEntries(profile.workloads.map((workload) => [workload.id, createSamples()]));
const fixtureRoot = await mkdtemp(join(tmpdir(), "pi67-session-open-"));

try {
  for (const workload of profile.workloads) {
    const sessionPath = join(fixtureRoot, `session-open-${workload.id}.jsonl`);
    console.log(`Session open ${workload.label}: generating synthetic fixture`);
    const fixture = await writeSyntheticSessionOpenFixture({
      path: sessionPath,
      cwd: fixtureRoot,
      targetBytes: workload.targetBytes
    });
    for (let index = 0; index < sampleCount; index += 1) {
      console.log(`Session open ${workload.label} sample ${index + 1}/${sampleCount}: start`);
      const result = await runSample({
        sessionPath,
        cwd: fixtureRoot,
        expectedMessageCount: fixture.messageCount
      });
      pushResult(samples[workload.id], {
        ...result,
        fixtureBytes: fixture.byteLength,
        fixtureWriteMs: fixture.fixtureWriteMs
      });
      console.log(`Session open ${workload.label} sample ${index + 1}/${sampleCount}: complete`);
    }
  }
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

await writeSessionOpenPerformanceReport({
  root,
  outputPath,
  profile: profile.id,
  workloads: profile.workloads,
  samples
});

async function runSample(input) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--expose-gc", childPath, JSON.stringify(input)],
    { encoding: "utf8", maxBuffer: 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

function createSamples() {
  return {
    openMs: [],
    eventLoopDelayMs: [],
    projectionBindMs: [],
    firstPageMs: [],
    userMessagePageMs: [],
    retainedRssBytes: [],
    retainedHeapBytes: [],
    messageCount: [],
    fixtureBytes: [],
    fixtureWriteMs: [],
    firstPageBytes: [],
    userMessagePageBytes: []
  };
}

function pushResult(target, result) {
  for (const field of Object.keys(target)) {
    const value = result[field];
    if (!Number.isFinite(value)) throw new Error(`Invalid Session-open sample field: ${field}`);
    target[field].push(value);
  }
}
