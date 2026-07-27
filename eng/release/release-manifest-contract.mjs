import { valid as validSemver } from "semver";

const SIGNED_RELEASE_MANIFEST_SCHEMA_VERSION = 2;

export function parseCanonicalStableVersion(value, label = "stable version") {
  if (typeof value !== "string"
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value)
    || validSemver(value) !== value) {
    throw new Error(`Invalid canonical ${label}: ${String(value)}.`);
  }
  return value;
}

export function parseCanonicalStableTag(value, label = "stable release tag") {
  if (typeof value !== "string" || !value.startsWith("v")) {
    throw new Error(`Invalid canonical ${label}: ${String(value)}.`);
  }
  return parseCanonicalStableVersion(value.slice(1), label);
}

export function expectedSignedReleaseArtifacts(version) {
  const stableVersion = parseCanonicalStableVersion(version);
  return new Map([
    [`Pi-67-Desktop-${stableVersion}-win-x64.exe`, "windows-x64"],
    [`Pi-67-Desktop-${stableVersion}-mac-arm64.dmg`, "macos-arm64"],
    [`Pi-67-Desktop-${stableVersion}-mac-arm64.zip`, "macos-arm64"]
  ]);
}

export function findUnexpectedSignedReleaseProductArtifacts(version, names) {
  const expected = expectedSignedReleaseArtifacts(version);
  return [...names].filter((name) => (
    typeof name === "string"
    && /^Pi-67-Desktop-.*\.(?:exe|dmg|zip)$/iu.test(name)
    && !expected.has(name)
  ));
}

export function createSignedReleaseManifest({ files, runtime, version }) {
  const manifest = {
    schemaVersion: SIGNED_RELEASE_MANIFEST_SCHEMA_VERSION,
    product: "Pi-67 Desktop",
    channel: "stable",
    signed: true,
    version,
    runtime,
    files
  };
  const failures = validateSignedReleaseManifest(manifest, version);
  if (failures.length > 0) {
    throw new Error(`Invalid signed release manifest:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  return manifest;
}

export function validateSignedReleaseManifest(manifest, expectedVersion) {
  const failures = [];
  let version;
  try {
    version = parseCanonicalStableVersion(manifest?.version);
  } catch {
    failures.push("invalid stable release version");
  }
  if (expectedVersion !== undefined && version !== expectedVersion) {
    failures.push("release manifest version mismatch");
  }
  if (manifest?.schemaVersion !== SIGNED_RELEASE_MANIFEST_SCHEMA_VERSION
    || manifest?.product !== "Pi-67 Desktop"
    || manifest?.channel !== "stable"
    || manifest?.signed !== true) {
    failures.push("invalid signed release manifest identity");
  }
  const runtime = typeof manifest?.runtime === "string" ? manifest.runtime : "";
  const runtimeMatch = /^@earendil-works\/pi-coding-agent@(.+)$/u.exec(runtime);
  if (runtime.includes("\r")
    || runtime.includes("\n")
    || runtime.includes("\u0000")
    || !runtimeMatch
    || validSemver(runtimeMatch[1]) !== runtimeMatch[1]) {
    failures.push("invalid Pi runtime identity");
  }

  const expectedFiles = version ? expectedSignedReleaseArtifacts(version) : new Map();
  const entries = Array.isArray(manifest?.files) ? manifest.files : [];
  if (entries.length !== expectedFiles.size) failures.push("release manifest must contain exactly three artifacts");
  const names = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || names.has(entry.name)) {
      failures.push("release manifest contains an invalid or duplicate artifact name");
      continue;
    }
    names.add(entry.name);
    const target = expectedFiles.get(entry.name);
    if (!target || entry.target !== target) failures.push(`unexpected release artifact ${entry.name}`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1) failures.push(`${entry.name}: invalid byte length`);
    if (!/^[0-9a-f]{64}$/u.test(entry.sha256 ?? "")) failures.push(`${entry.name}: invalid SHA-256`);
  }
  for (const expectedName of expectedFiles.keys()) {
    if (!names.has(expectedName)) failures.push(`release manifest is missing ${expectedName}`);
  }
  return failures;
}
