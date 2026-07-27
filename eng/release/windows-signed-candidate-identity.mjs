import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWindowsArtifactSigner,
  readWindowsArtifactIdentity
} from "../packaging/windows-artifact-identity.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import {
  assertWindowsSignedCandidateIdentity,
  WINDOWS_SIGNED_CANDIDATE_SCHEMA,
  WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY
} from "./windows-signed-candidate-contract.mjs";

export {
  assertWindowsSignedCandidateIdentity,
  hashWindowsSignedCandidateIdentity,
  readHashedWindowsSignedCandidateIdentity,
  readWindowsSignedCandidateIdentity,
  WINDOWS_SIGNED_CANDIDATE_SCHEMA,
  WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY
} from "./windows-signed-candidate-contract.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function createWindowsSignedCandidateIdentity({
  expectedSignerThumbprint,
  installerPath,
  packagedExecutablePath,
  repository,
  runAttempt,
  runId,
  sourcePolicy = WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable,
  sourceCommit,
  sourceTag,
  version
}) {
  const [installer, packagedExecutable, runtime] = await Promise.all([
    readWindowsArtifactIdentity(installerPath),
    readWindowsArtifactIdentity(packagedExecutablePath),
    readPiRuntimeContract(repositoryRoot)
  ]);
  assertWindowsArtifactSigner(installer, expectedSignerThumbprint, "Signed candidate installer");
  assertWindowsArtifactSigner(packagedExecutable, expectedSignerThumbprint, "Signed candidate executable");
  const value = {
    schema: WINDOWS_SIGNED_CANDIDATE_SCHEMA,
    repository,
    workflow: { runId, runAttempt },
    source: { policy: sourcePolicy, tag: sourceTag, commit: sourceCommit },
    application: {
      product: "Pi-67 Desktop",
      version,
      platform: "win32",
      architecture: "x64",
      runtime: runtime.runtimeSpecifier
    },
    installer: signedFileIdentity(installer, basename(installerPath)),
    packagedExecutable: signedFileIdentity(
      packagedExecutable,
      relative(resolve(repositoryRoot, "artifacts/release"), resolve(packagedExecutablePath)).replaceAll("\\", "/")
    )
  };
  assertWindowsSignedCandidateIdentity(value, {
    repository,
    sourcePolicy,
    sourceTag,
    sourceCommit,
    runId,
    runAttempt,
    version,
    expectedSignerThumbprint
  });
  return value;
}

function signedFileIdentity(identity, fileName) {
  return {
    fileName,
    byteLength: identity.byteLength,
    sha256: identity.sha256,
    authenticode: identity.authenticode
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsByName = parseNamedArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const outputPath = requiredArgument(argumentsByName, "--output");
  const identity = await createWindowsSignedCandidateIdentity({
    expectedSignerThumbprint: requiredArgument(argumentsByName, "--expected-signer"),
    installerPath: requiredArgument(argumentsByName, "--installer"),
    packagedExecutablePath: requiredArgument(argumentsByName, "--packaged-executable"),
    repository: requiredArgument(argumentsByName, "--repository"),
    runAttempt: requiredArgument(argumentsByName, "--run-attempt"),
    runId: requiredArgument(argumentsByName, "--run-id"),
    sourcePolicy: optionalArgument(
      argumentsByName,
      "--source-policy",
      WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable
    ),
    sourceCommit: requiredArgument(argumentsByName, "--source-commit"),
    sourceTag: requiredArgument(argumentsByName, "--source-tag"),
    version: packageJson.version
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Wrote Windows signed candidate identity ${relative(repositoryRoot, outputPath)}.`);
}

function parseNamedArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) throw new Error("Windows signed candidate identity arguments are incomplete.");
  const allowed = new Set([
    "--expected-signer",
    "--installer",
    "--output",
    "--packaged-executable",
    "--repository",
    "--run-attempt",
    "--run-id",
    "--source-commit",
    "--source-policy",
    "--source-tag"
  ]);
  const result = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(name) || result.has(name)) {
      throw new Error(`Invalid Windows signed candidate identity argument: ${name}.`);
    }
    result.set(name, value);
  }
  return result;
}

function optionalArgument(argumentsByName, name, fallback) {
  return argumentsByName.get(name) ?? fallback;
}

function requiredArgument(argumentsByName, name) {
  const value = argumentsByName.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
