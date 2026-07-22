import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadVersionContract } from "../version/version-contract.mjs";
import {
  createReleaseManifestDocument,
  releaseManifestName,
} from "./release-artifact-contract.mjs";
import { resolveSourceState } from "./source-revision.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const artifactRoot = path.resolve(argument("--root", "artifacts/release"));
const output = path.resolve(argument("--output", path.join(artifactRoot, releaseManifestName)));
if (path.dirname(output) !== artifactRoot || path.basename(output) !== releaseManifestName) {
  throw new Error(`${releaseManifestName} must be written directly inside the release root`);
}

const version = await loadVersionContract();
const manifest = await createReleaseManifestDocument(artifactRoot, version, resolveSourceState());
await mkdir(artifactRoot, { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${output}\n`);
