import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import {
  expectedSignedReleaseArtifacts,
  findUnexpectedSignedReleaseProductArtifacts,
  validateSignedReleaseManifest
} from "./release-manifest-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const releaseDirectory = join(root, "artifacts/release");
const manifest = JSON.parse(await readFile(join(releaseDirectory, "release-manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const { runtimeSpecifier } = await readPiRuntimeContract(root);
const failures = [];
const entries = Array.isArray(manifest.files) ? manifest.files : [];
const expectedArtifacts = expectedSignedReleaseArtifacts(packageJson.version);
const expectedNames = new Set(expectedArtifacts.keys());
const releaseEntries = await readdir(releaseDirectory, { withFileTypes: true });

failures.push(...validateSignedReleaseManifest(manifest, packageJson.version));
if (manifest.runtime !== runtimeSpecifier) failures.push(`release manifest runtime must be ${runtimeSpecifier}`);

const actualNames = new Set(entries.map((entry) => entry?.name).filter((name) => typeof name === "string"));
for (const name of expectedNames) if (!actualNames.has(name)) failures.push(`release manifest is missing ${name}`);
if (actualNames.size !== entries.length) failures.push("release manifest contains duplicate artifact names");
for (const name of findUnexpectedSignedReleaseProductArtifacts(
  packageJson.version,
  releaseEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
)) {
  failures.push(`release directory contains an unsupported product artifact: ${name}`);
}

for (const entry of entries) {
  if (typeof entry.name !== "string" || !/^Pi-67-Desktop-[0-9A-Za-z.-]+-(?:win-x64\.exe|mac-arm64\.(?:dmg|zip))$/u.test(entry.name)) {
    failures.push(`unsupported artifact name: ${String(entry.name)}`);
    continue;
  }
  const path = join(releaseDirectory, entry.name);
  try {
    const bytes = (await stat(path)).size;
    const sha256 = await hashFile(path);
    if (bytes !== entry.bytes) failures.push(`${entry.name}: size mismatch`);
    if (sha256 !== entry.sha256) failures.push(`${entry.name}: SHA-256 mismatch`);
    const expectedTarget = expectedArtifacts.get(entry.name);
    if (entry.target !== expectedTarget) failures.push(`${entry.name}: target mismatch`);
  } catch {
    failures.push(`${entry.name}: file is missing`);
  }
}

if (failures.length > 0) {
  console.error(`Release verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Verified ${entries.length} release artifact(s) for ${manifest.version}.`);

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
