import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveSourceState } from "./source-revision.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const artifactRoot = path.resolve(argument("--root", "artifacts/release"));
const output = path.resolve(argument("--output", path.join(artifactRoot, "provenance.intoto.json")));
const excluded = new Set([path.relative(artifactRoot, output), "SHA256SUMS"]);

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

const subjects = [];
for (const file of await walk(artifactRoot)) {
  const name = path.relative(artifactRoot, file).split(path.sep).join("/");
  if (excluded.has(name)) continue;
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  subjects.push({ name, digest: { sha256: digest }, size: (await stat(file)).size });
}
subjects.sort((left, right) => left.name.localeCompare(right.name));

const { revision, dirty } = resolveSourceState();
const buildWorkflow = process.env.PI67_BUILD_WORKFLOW ?? ".github/workflows/ci.yml";
if (!/^\.github\/workflows\/[a-z0-9-]+\.yml$/u.test(buildWorkflow)) {
  throw new Error("PI67_BUILD_WORKFLOW must identify a repository workflow YAML file");
}

const statement = {
  _type: "https://in-toto.io/Statement/v1",
  subject: subjects.map(({ name, digest }) => ({ name, digest })),
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: `https://github.com/bigKING67/pi-67-desktop/${buildWorkflow}@${revision}`,
      externalParameters: {
        configuration: "Release",
        runtimeIdentifier: "win-x64",
      },
      internalParameters: {
        dotnetSdk: "10.0.302",
        node: "24.18.0",
        npm: "11.16.0",
      },
      resolvedDependencies: [{ uri: "git+https://github.com/bigKING67/pi-67-desktop", digest: { gitCommit: revision } }],
    },
    runDetails: {
      builder: { id: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "local-unverified-builder" },
      metadata: {
        invocationId: process.env.GITHUB_RUN_ID ?? "local",
        startedOn: new Date().toISOString(),
        finishedOn: new Date().toISOString(),
        sourceDirty: dirty,
      },
    },
  },
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(statement, null, 2)}\n`);
process.stdout.write(`${output}\n`);
