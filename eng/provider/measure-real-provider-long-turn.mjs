import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertPackagedRuntimeAssets,
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  repositoryRoot,
  resolvePackagedArtifact
} from "../packaging/packaged-electron-fixture.mjs";
import {
  createRealProviderLongTurnReceipt,
  createRealProviderLongTurnFailureSummary,
  createRealProviderLongTurnSummary,
  readRealProviderLongTurnConfig
} from "./real-provider-long-turn-contract.mjs";
import { readHashedWindowsSignedCandidateIdentity } from "../release/windows-signed-candidate-contract.mjs";
import { writeProviderCertificationFailureAndThrow } from "./provider-certification-failure.mjs";
import { writeControlledProviderTool } from "./real-provider-long-turn-fixture.mjs";
import { runRealProviderPackagedScenario } from "./real-provider-packaged-scenario.mjs";
import { readIsolatedSessionIdentity } from "./real-provider-session-identity.mjs";

const config = readRealProviderLongTurnConfig(process.env);
const artifact = resolvePackagedArtifact();
await assertPackagedRuntimeAssets(artifact);
const executableSha256 = await hashFile(artifact.executablePath);
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));

const directories = await createPackagedTestDirectories(
  "pi67-real-provider-long-turn-"
);
const lifecyclePath = join(directories.userDataDirectory, "provider-tool-lifecycle.txt");
const extensionPath = join(
  directories.extensionsDirectory,
  "real-provider-long-turn.ts"
);
const outputPath = config.outputPath
  ? resolve(repositoryRoot, config.outputPath)
  : join(repositoryRoot, "artifacts/validation/provider-long-turn/summary.json");
const evidence = {
  artifactResolved: true,
  applicationLaunched: false,
  rendererBoundaryVerified: false,
  runtimeReady: false,
  credentialInstalled: false,
  modelSelected: false,
  promptSubmitted: false,
  promptAccepted: false,
  toolApproved: false,
  toolStarted: false,
  toolCompleted: false,
  terminalObserved: false,
  sessionReceiptVerified: false
};
let failureStage = "prepare-controlled-tool";
let candidateIdentity;
let candidateIdentitySha256;

try {
  if (config.requireCandidateIdentity && !config.candidateIdentityPath) {
    throw new Error("Formal Provider certification requires a signed candidate identity.");
  }
  if (config.candidateIdentityPath) {
    failureStage = "candidate-identity";
    const candidate = await readHashedWindowsSignedCandidateIdentity(
      resolve(repositoryRoot, config.candidateIdentityPath),
      {
        expectedSignerThumbprint: config.expectedSignerThumbprint,
        packagedExecutableSha256: executableSha256,
        repository: config.expectedRepository,
        runAttempt: config.candidateRunAttempt,
        runId: config.candidateRunId,
        sourceCommit: config.sourceCommit,
        sourcePolicy: config.candidateSourcePolicy,
        sourceTag: config.sourceTag,
        version: packageJson.version
      }
    );
    candidateIdentity = candidate.identity;
    candidateIdentitySha256 = candidate.identitySha256;
  }
  failureStage = "prepare-controlled-tool";
  await writeControlledProviderTool({
    extensionPath,
    lifecyclePath,
    delayMs: config.toolDelayMs
  });
  failureStage = "run-provider-turn";
  const scenario = await runRealProviderPackagedScenario({
    artifact,
    config,
    directories,
    evidence,
    lifecyclePath,
    onStage: (stage) => {
      failureStage = stage;
    }
  });
  failureStage = "session-receipt";
  const session = await readIsolatedSessionIdentity(directories.agentDir);
  evidence.sessionReceiptVerified = true;
  failureStage = "build-receipt";
  const receipt = createRealProviderLongTurnReceipt({
    protocol: scenario.protocol,
    lifecycle: scenario.lifecycle,
    toolDelayMs: config.toolDelayMs,
    session
  });
  const summary = createRealProviderLongTurnSummary({
    appVersion: scenario.appVersion,
    platform: artifact.platform,
    architecture: artifact.arch,
    executableSha256,
    providerId: config.providerId,
    modelId: config.modelId,
    requestedThinkingLevel: config.thinkingLevel,
    effectiveThinkingLevel: scenario.selection.effectiveThinkingLevel,
    rendererUrl: scenario.rendererUrl,
    hostPid: scenario.hostPid,
    sourceCommit: config.sourceCommit,
    sourceTag: config.sourceTag,
    candidateIdentity,
    candidateIdentitySha256,
    candidateSourcePolicy: config.candidateSourcePolicy,
    receipt
  });
  failureStage = "write-receipt";
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(
    `Real Provider long-turn receipt passed: accepted=${Math.round(receipt.acceptedLatencyMs)}ms, `
    + `tool=${Math.round(receipt.toolDurationMs)}ms, terminal=${receipt.terminalType}, output=${outputPath}`
  );
} catch {
  const failure = createRealProviderLongTurnFailureSummary({
    appVersion: packageJson.version,
    platform: artifact.platform,
    architecture: artifact.arch,
    executableSha256,
    providerId: config.providerId,
    modelId: config.modelId,
    requestedThinkingLevel: config.thinkingLevel,
    sourceCommit: config.sourceCommit,
    sourceTag: config.sourceTag,
    candidateIdentity,
    candidateIdentitySha256,
    candidateSourcePolicy: config.candidateSourcePolicy,
    failureStage,
    evidence
  });
  await writeProviderCertificationFailureAndThrow(outputPath, failure);
} finally {
  await cleanupPackagedTestDirectories(directories.userDataDirectory);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
