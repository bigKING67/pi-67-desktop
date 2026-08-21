import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordWindowsPreviewManualTest } from "./windows-preview-promotion.mjs";

export function parseWindowsPreviewManualTestArguments(argumentsList) {
  const normalizedArguments = argumentsList[0] === "--" ? argumentsList.slice(1) : argumentsList;
  if (normalizedArguments.length % 2 !== 0) {
    throw new Error("Windows preview manual-test arguments are incomplete.");
  }
  const allowed = new Set([
    "--actor",
    "--candidate-identity",
    "--candidate-run-attempt",
    "--candidate-run-id",
    "--candidate-run-metadata",
    "--installer",
    "--output",
    "--packaged-executable",
    "--repository",
    "--source-commit"
  ]);
  const values = new Map();
  for (let index = 0; index < normalizedArguments.length; index += 2) {
    const name = normalizedArguments[index];
    if (!allowed.has(name) || values.has(name)) throw new Error(`Invalid Windows preview manual-test argument: ${name}.`);
    values.set(name, normalizedArguments[index + 1]);
  }
  return values;
}

function requiredArgument(values, name) {
  const value = values.get(name);
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`${name} requires a non-empty single-line value.`);
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = parseWindowsPreviewManualTestArguments(process.argv.slice(2));
  const outputPath = requiredArgument(values, "--output");
  const result = await recordWindowsPreviewManualTest({
    actor: requiredArgument(values, "--actor"),
    candidateIdentityPath: requiredArgument(values, "--candidate-identity"),
    candidateRunAttempt: requiredArgument(values, "--candidate-run-attempt"),
    candidateRunId: requiredArgument(values, "--candidate-run-id"),
    candidateRunMetadataPath: requiredArgument(values, "--candidate-run-metadata"),
    installerPath: requiredArgument(values, "--installer"),
    outputPath,
    packagedExecutablePath: requiredArgument(values, "--packaged-executable"),
    repository: requiredArgument(values, "--repository"),
    sourceCommit: requiredArgument(values, "--source-commit")
  });
  console.log(
    `Bound operator-confirmed Windows test to candidate ${result.receipt.candidate.identitySha256} at ${outputPath}.`
  );
}
