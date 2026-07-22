import path from "node:path";
import process from "node:process";

import { loadVersionContract } from "../version/version-contract.mjs";
import { verifyReleaseArtifactSet } from "./release-artifact-contract.mjs";

const rootIndex = process.argv.indexOf("--root");
const artifactRoot = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : "artifacts/release");
const version = await loadVersionContract();
const issues = await verifyReleaseArtifactSet(artifactRoot, version);

if (issues.length > 0) {
  process.stderr.write(`Release artifact verification failed:\n- ${issues.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${artifactRoot} for ${version.releaseTag}.\n`);
}
