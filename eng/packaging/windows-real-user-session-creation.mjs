import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createSessionCreationDiagnostic } from "./windows-installer-identity.mjs";

const SESSION_CREATION_POLL_INTERVAL_MS = 50;

export async function prepareRealUserSessionCreation(window, agentDir, timeoutMs) {
  const createAction = window.getByRole("button", { name: /^在 .+ 新建会话$/u }).first();
  // Capture the baseline only after Workspace initialization admits the action.
  await createAction.click({ trial: true, timeout: timeoutMs });
  const existingIdentities = new Set(await window.locator('[data-testid="conversation-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-conversation-id")).filter(Boolean)));
  const existingSessionFileNames = await readRealUserSessionFileNames(agentDir);
  return { createAction, existingIdentities, existingSessionFileNames };
}

export async function waitForSelectedProvisionalSessionIntent(
  window,
  agentDir,
  existingIdentities,
  existingSessionFileNames,
  deadline
) {
  const existing = [...existingIdentities];
  const existingFiles = [...existingSessionFileNames];
  let diagnostic = createSessionCreationDiagnostic(undefined, existing, existingFiles);
  while (performance.now() <= deadline) {
    const observation = await observeSessionCreation(window, existing, existingFiles);
    const currentSessionFileNames = await readRealUserSessionFileNames(agentDir);
    const newPhysicalSessionFileCount = [...currentSessionFileNames]
      .filter((fileName) => !existingSessionFileNames.has(fileName))
      .length;
    diagnostic = {
      ...createSessionCreationDiagnostic(observation, existing, existingFiles),
      newPhysicalSessionFileCount,
      newProvisionalRowCount: observation.newProvisionalIdentities.length
    };
    if (observation.newSessionRowCount > 0 || newPhysicalSessionFileCount > 0) {
      throw new Error(
        `Windows real-user new Session intent materialized before its first Prompt: ${JSON.stringify(diagnostic)}`
      );
    }
    if (observation.newProvisionalIdentities.length > 1 || observation.provisionalRowCount > 1) {
      throw new Error(
        `Windows real-user new Session intent created duplicate provisional rows: ${JSON.stringify(diagnostic)}`
      );
    }
    const provisionalIdentity = observation.newProvisionalIdentities[0] ?? null;
    if (provisionalIdentity && observation.selectedIdentity === provisionalIdentity) {
      return provisionalIdentity;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, SESSION_CREATION_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Windows real-user new Session intent exceeded its 15s hard gate: ${JSON.stringify(diagnostic)}`
  );
}

export async function waitForRealUserCreatedSession(
  window,
  existingIdentities,
  existingSessionFileNames,
  deadline
) {
  const existing = [...existingIdentities];
  const existingFiles = [...existingSessionFileNames];
  let diagnostic = createSessionCreationDiagnostic(undefined, existing, existingFiles);
  while (performance.now() <= deadline) {
    const observation = await observeSessionCreation(window, existing, existingFiles);
    const newSessionIdentity = observation.newSessionIdentities[0] ?? null;
    diagnostic = createSessionCreationDiagnostic(observation, existing, existingFiles);
    if (observation.newSessionRowCount > 1) {
      throw new Error(`Windows real-user session.create materialized duplicate Sessions: ${JSON.stringify(diagnostic)}`);
    }
    if (newSessionIdentity && observation.selectedNewSession) return newSessionIdentity;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, SESSION_CREATION_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Windows real-user session.create exceeded its 15s hard gate: ${JSON.stringify(diagnostic)}`
  );
}

function observeSessionCreation(window, existingIdentities, existingSessionFileNames) {
  return window.evaluate((baseline) => {
    const rows = [...document.querySelectorAll('[data-testid="conversation-row"]')];
    const sessionRows = rows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("session:"));
    const provisionalRows = rows.filter((row) => (
      row.getAttribute("data-conversation-id")?.startsWith("provisional:")
    ));
    const newSessionRows = sessionRows.filter((row) => {
      const identity = row.getAttribute("data-conversation-id") ?? "";
      if (baseline.identities.includes(identity)) return false;
      const separatorIndex = Math.max(
        identity.lastIndexOf("/"),
        identity.lastIndexOf("\\"),
        identity.lastIndexOf(":")
      );
      return !baseline.fileNames.includes(identity.slice(separatorIndex + 1));
    });
    const newProvisionalRows = provisionalRows.filter((row) => (
      !baseline.identities.includes(row.getAttribute("data-conversation-id") ?? "")
    ));
    const selected = rows.find((row) => row.getAttribute("aria-current") === "page");
    const runtimeStatus = document.querySelector('[aria-label^="当前状态："]');
    const errorNotifications = [...document.querySelectorAll('[aria-label="通知"] [role="alert"]')];
    return {
      errorNotificationCount: errorNotifications.length,
      errorNotificationTitles: errorNotifications.slice(0, 3).map((notification) => (
        notification.querySelector("strong")?.textContent?.trim().slice(0, 160) ?? null
      )),
      newProvisionalIdentities: newProvisionalRows
        .map((row) => row.getAttribute("data-conversation-id") ?? ""),
      newSessionIdentities: newSessionRows.map((row) => row.getAttribute("data-conversation-id") ?? ""),
      newSessionRowCount: newSessionRows.length,
      provisionalRowCount: provisionalRows.length,
      rowCount: rows.length,
      runtimePhase: runtimeStatus?.getAttribute("data-runtime-phase") ?? null,
      runtimeStatus: runtimeStatus?.getAttribute("aria-label")?.slice(0, 160) ?? null,
      selectedIdentity: selected?.getAttribute("data-conversation-id") ?? null,
      selectedNewSession: newSessionRows.includes(selected),
      selectedProvisional: provisionalRows.includes(selected),
      sessionIdentities: sessionRows.map((row) => row.getAttribute("data-conversation-id") ?? ""),
      sessionRowCount: sessionRows.length
    };
  }, { identities: existingIdentities, fileNames: existingSessionFileNames });
}

async function readRealUserSessionFileNames(agentDir) {
  const sessionsRoot = join(agentDir, "sessions");
  const rootEntries = await readDirectoryEntries(sessionsRoot);
  const directFileNames = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name);
  const nestedFileNames = await Promise.all(rootEntries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => (await readDirectoryEntries(join(sessionsRoot, entry.name)))
      .filter((child) => child.isFile() && child.name.endsWith(".jsonl"))
      .map((child) => child.name)));
  return new Set([...directFileNames, ...nestedFileNames.flat()]);
}

function readDirectoryEntries(path) {
  return readdir(path, { withFileTypes: true }).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
}
