import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function resolveSampleCount() {
  const raw = process.env.PI67_PERF_SAMPLES ?? "10";
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error("PI67_PERF_SAMPLES must be an integer from 1 to 50.");
  }
  return value;
}

export function summarizeMetric({
  id,
  label,
  unit,
  samples,
  budget,
  evidenceLevel,
  method,
  limitations = []
}) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some((value) => !Number.isFinite(value))) {
    throw new Error(`${id} requires at least one finite sample.`);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  return {
    id,
    label,
    unit,
    direction: "max",
    ...(budget === undefined ? {} : { budget }),
    status: budget === undefined ? "informational" : p95 <= budget ? "pass" : "fail",
    sampleCount: samples.length,
    samples: samples.map(round),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    p50: round(p50),
    p95: round(p95),
    evidenceLevel,
    method,
    limitations
  };
}

export function percentile(sortedSamples, fraction) {
  if (sortedSamples.length === 0) throw new Error("Cannot calculate a percentile without samples.");
  const index = Math.max(0, Math.ceil(sortedSamples.length * fraction) - 1);
  return sortedSamples[Math.min(index, sortedSamples.length - 1)];
}

export function droppedFrameRate(timestamps) {
  if (timestamps.length < 3) return 1;
  const intervals = timestamps.slice(1).map((value, index) => value - timestamps[index]);
  const baseline = percentile([...intervals].sort((left, right) => left - right), 0.5);
  if (baseline <= 0) return 1;
  let missed = 0;
  for (const interval of intervals) missed += Math.max(0, Math.round(interval / baseline) - 1);
  return missed / (intervals.length + missed);
}

export async function createReport({ root, suite, metrics, unverified = [] }) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const [commit, status] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1"])
  ]);
  const cpuList = cpus();
  return {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version: packageJson.version,
    suite,
    generatedAt: new Date().toISOString(),
    source: {
      commit: commit.trim(),
      dirty: status.trim().length > 0,
      changedPathCount: status.trim() ? status.trim().split("\n").length : 0
    },
    host: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      cpu: cpuList[0]?.model ?? "unknown",
      logicalCpuCount: cpuList.length,
      totalMemoryMiB: round(totalmem() / 1024 / 1024),
      node: process.version
    },
    metrics,
    unverified,
    verdict: metrics.some((metric) => metric.status === "fail") ? "fail" : "pass"
  };
}

export async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export function printReport(path, report) {
  console.log(`${report.suite} performance report: ${path}`);
  for (const metric of report.metrics) {
    const budget = metric.budget === undefined ? "informational" : `budget <= ${metric.budget}${metric.unit}`;
    console.log(`- ${metric.id}: p50=${metric.p50}${metric.unit}, p95=${metric.p95}${metric.unit}, ${budget}, ${metric.status}`);
  }
  for (const item of report.unverified) console.log(`- ${item.id}: unverified (${item.reason})`);
  console.log(`Verdict: ${report.verdict}`);
}

export function enforceReport(report) {
  if (process.env.PI67_PERF_ENFORCE === "1" && report.verdict !== "pass") {
    throw new Error(`${report.suite} performance budget failed.`);
  }
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

async function git(root, args) {
  const result = await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
  return result.stdout;
}
