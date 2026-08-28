import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gt as semverGt, prerelease, valid as validSemver } from "semver";
import { fetchPublicManifest } from "./r2-update-cloudflare-client.mjs";
import { R2_UPDATE_ORIGIN } from "./r2-update-release-contract.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const FETCH_TIMEOUT_MS = 15_000;

export function assertAvailablePreviewVersion(candidateVersion, publicManifest) {
  if (validSemver(candidateVersion) !== candidateVersion || prerelease(candidateVersion) === null) {
    throw new Error(`Preview candidate version is not a canonical prerelease: ${String(candidateVersion)}.`);
  }
  if (publicManifest === null) return { candidateVersion, publicVersion: null };
  if (
    publicManifest?.schemaVersion !== 1
    || publicManifest?.product !== "Pi-67 Desktop"
    || publicManifest?.channel !== "unsigned-preview"
    || publicManifest?.signed !== false
    || validSemver(publicManifest?.version) !== publicManifest?.version
  ) {
    throw new Error("Public unsigned preview manifest identity is invalid.");
  }
  if (!semverGt(candidateVersion, publicManifest.version)) {
    throw new Error(
      `Preview candidate ${candidateVersion} must be newer than public version ${publicManifest.version}.`
    );
  }
  return { candidateVersion, publicVersion: publicManifest.version };
}

export async function verifyPreviewVersionAvailability({
  candidateVersion,
  fetchImpl = fetch,
  origin = R2_UPDATE_ORIGIN
}) {
  const publicManifest = await fetchPublicManifest(origin, (url, options) => fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  }));
  return assertAvailablePreviewVersion(candidateVersion, publicManifest);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const result = await verifyPreviewVersionAvailability({ candidateVersion: packageJson.version });
  console.log(result.publicVersion === null
    ? `Verified unpublished preview version ${result.candidateVersion}; no public manifest exists.`
    : `Verified preview version ${result.candidateVersion} is newer than public ${result.publicVersion}.`);
}
