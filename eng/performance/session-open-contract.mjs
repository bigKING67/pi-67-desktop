const MIB = 1024 * 1024;

export const SESSION_OPEN_PROFILES = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    workloads: Object.freeze([
      workload("10MiB", "10 MiB", 10 * MIB),
      workload("100MiB", "100 MiB", 100 * MIB)
    ])
  }),
  extended: Object.freeze({
    id: "extended",
    workloads: Object.freeze([
      workload("10MiB", "10 MiB", 10 * MIB),
      workload("100MiB", "100 MiB", 100 * MIB),
      workload("500MiB", "500 MiB", 500 * MIB)
    ])
  })
});

export function resolveSessionOpenProfile(
  value = process.env.PI67_PERF_SESSION_OPEN_PROFILE ?? "standard"
) {
  const profile = SESSION_OPEN_PROFILES[value];
  if (!profile) throw new Error("PI67_PERF_SESSION_OPEN_PROFILE must be standard or extended.");
  return profile;
}

export function resolveSessionOpenSampleCount(profile = resolveSessionOpenProfile()) {
  const fallback = profile.id === "extended"
    ? "1"
    : (process.env.PI67_PERF_SAMPLES ?? "10");
  const raw = process.env.PI67_PERF_SESSION_OPEN_SAMPLES ?? fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error("PI67_PERF_SESSION_OPEN_SAMPLES must be an integer from 1 to 50.");
  }
  return value;
}

function workload(id, label, targetBytes) {
  return Object.freeze({
    id,
    label,
    metricSuffix: id,
    targetBytes
  });
}
