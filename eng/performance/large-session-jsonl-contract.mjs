const MIB = 1024 * 1024;

const STANDARD_WORKLOAD = Object.freeze({
  id: "100mib-100k",
  metricSuffix: "100MiB100k",
  label: "100 MiB / 100,000 records",
  totalBytes: 100 * MIB,
  recordCount: 100_000
});

const EXTENDED_WORKLOAD = Object.freeze({
  id: "500mib-100k",
  metricSuffix: "500MiB100k",
  label: "500 MiB / 100,000 records",
  totalBytes: 500 * MIB,
  recordCount: 100_000
});

export const LARGE_SESSION_JSONL_PROFILES = Object.freeze({
  standard: Object.freeze([STANDARD_WORKLOAD]),
  extended: Object.freeze([STANDARD_WORKLOAD, EXTENDED_WORKLOAD])
});

export function resolveLargeSessionJsonlProfile(raw = process.env.PI67_PERF_LARGE_SESSION_PROFILE ?? "standard") {
  if (raw !== "standard" && raw !== "extended") {
    throw new Error("PI67_PERF_LARGE_SESSION_PROFILE must be standard or extended.");
  }
  return { id: raw, workloads: LARGE_SESSION_JSONL_PROFILES[raw] };
}

export function resolveLargeSessionJsonlSampleCount(
  raw = process.env.PI67_PERF_LARGE_SESSION_SAMPLES ?? "1"
) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("PI67_PERF_LARGE_SESSION_SAMPLES must be an integer from 1 to 5.");
  }
  return value;
}
