import { realpath, stat } from "node:fs/promises";
import * as systemPath from "node:path";
import {
  submitControlledPromptInput,
  waitForControlledModel,
  waitForControlledPromptRunning
} from "./controlled-provider-interaction.mjs";
import { assertSessionPathContained } from "./windows-installer-identity.mjs";
import {
  prepareRealUserSessionCreation,
  waitForSelectedProvisionalSessionIntent,
  waitForRealUserCreatedSession
} from "./windows-real-user-session-creation.mjs";

const POLL_INTERVAL_MS = 50;
const SESSION_JSONL_TIMEOUT_MS = 10_000;

export async function createControlledConversation(window, agentDir, contract) {
  const { createAction, existingIdentities, existingSessionFileNames } = await prepareRealUserSessionCreation(
    window,
    agentDir,
    contract.createHardTimeoutMs
  );
  const intentStartedAt = performance.now();
  await createAction.click({ timeout: contract.createHardTimeoutMs });
  await waitForSelectedProvisionalSessionIntent(
    window,
    agentDir,
    existingIdentities,
    existingSessionFileNames,
    intentStartedAt + contract.createHardTimeoutMs
  );
  const intentDurationMs = performance.now() - intentStartedAt;

  const materializationStartedAt = performance.now();
  await submitControlledPromptInput(window);
  const createdSession = await waitForRealUserCreatedSession(
    window,
    existingIdentities,
    existingSessionFileNames,
    agentDir,
    materializationStartedAt + contract.createHardTimeoutMs
  );
  const materializationDurationMs = performance.now() - materializationStartedAt;
  if (materializationDurationMs > contract.createHardTimeoutMs) {
    throw new Error("Windows real-user session.create succeeded after its 15s hard gate.");
  }
  await canonicalContainedSessionPath(createdSession.sessionPath, agentDir);

  await waitForControlledModel(window, contract.modelHydrationTimeoutMs);
  await waitForControlledPromptRunning(window);
  await window.getByRole("button", { name: "停止", exact: true }).click({ timeout: 10_000 });
  await window.getByRole("button", { name: "停止", exact: true })
    .waitFor({ state: "hidden", timeout: 10_000 });
  await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 10_000 });
  await waitForCondition(async () => (
    (await window.locator('[data-testid="conversation-row"][aria-current="page"]')
      .getByText("运行中", { exact: true }).count()) === 0
  ), 10_000, "Windows real-user controlled operation remained marked as running");

  return {
    report: {
      candidateSessionRowCount: createdSession.diagnostic.candidateSessionRowCount,
      durationMs: round(materializationDurationMs),
      hardGateMs: contract.createHardTimeoutMs,
      intentDurationMs: round(intentDurationMs),
      jsonlMaterialized: true,
      materializationTrigger: "first-prompt",
      newPhysicalSessionFileCount: createdSession.diagnostic.newPhysicalSessionFileCount,
      newPhysicalSessionFileNames: createdSession.diagnostic.newPhysicalSessionFileNames,
      newSessionRowCount: createdSession.diagnostic.newSessionRowCount,
      operationOutcome: "user-stopped",
      provisionalIntentObserved: true,
      selectedIdentityFingerprint: createdSession.diagnostic.selectedIdentityFingerprint,
      selectedNewSession: createdSession.diagnostic.selectedNewSession,
      selectedProvisional: createdSession.diagnostic.selectedProvisional,
      targetMet: materializationDurationMs <= contract.createTargetMs,
      targetMs: contract.createTargetMs
    },
    sessionIdentity: createdSession.sessionIdentity
  };
}

export async function canonicalContainedSessionPath(sessionPath, agentDir) {
  const canonicalAgentDir = await realpath(systemPath.resolve(agentDir)).catch(() => {
    throw new Error("Windows real-user isolated Agent directory could not be canonicalized.");
  });
  const resolvedSessionPath = systemPath.resolve(sessionPath);
  await waitForSessionJsonl(resolvedSessionPath);
  const canonicalSessionPath = await realpath(resolvedSessionPath).catch(() => {
    throw new Error("Windows real-user Pi Session JSONL could not be canonicalized.");
  });
  assertSessionPathContained(canonicalAgentDir, canonicalSessionPath);
  return canonicalSessionPath;
}

async function waitForSessionJsonl(sessionPath) {
  await waitForCondition(async () => {
    const metadata = await stat(sessionPath).catch(() => undefined);
    return metadata?.isFile() && metadata.size > 0 ? true : undefined;
  }, SESSION_JSONL_TIMEOUT_MS, "Windows real-user Pi Session JSONL did not materialize");
}

async function waitForCondition(action, timeoutMs, failureMessage) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    const result = await action();
    if (result !== undefined && result !== false) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`${failureMessage} after ${timeoutMs}ms.`);
}

function round(value) {
  return Math.round(value * 10) / 10;
}
