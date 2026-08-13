import { fingerprintSessionIdentity } from "./windows-installer-identity.mjs";

export const REAL_USER_CATALOG_TIMEOUT_MS = 5_000;

const POLL_INTERVAL_MS = 50;

export async function waitForCatalogRequestStart(window, timeoutMs) {
  const startedAt = performance.now();
  const workspaceGroup = window.getByTestId("workspace-group").first();
  await workspaceGroup.waitFor({ state: "visible", timeout: timeoutMs });
  let latestObservation;
  const observation = await waitForCatalogCondition(async () => {
    const current = await window.evaluate(() => {
      const shell = document.querySelector(".application-shell");
      const group = document.querySelector('[data-testid="workspace-group"]');
      const runtime = document.querySelector("[data-runtime-phase]");
      return {
        agentConnected: shell?.getAttribute("data-agent-connected") ?? null,
        catalogError: group?.getAttribute("data-catalog-error") ?? null,
        catalogLoading: group?.getAttribute("data-catalog-loading") ?? null,
        catalogState: group?.getAttribute("data-catalog-state") ?? null,
        runtimePhase: runtime?.getAttribute("data-runtime-phase") ?? null,
        workspaceOpenPending: shell?.getAttribute("data-workspace-open-pending") ?? null
      };
    });
    latestObservation = current;
    if (current.runtimePhase === "failed") {
      throw new Error(
        `Windows real-user Workspace opening failed before the Session Catalog started. Diagnostics: ${JSON.stringify(current)}`
      );
    }
    if (current.catalogError === "true") {
      throw new Error(
        `Windows real-user Session Catalog request failed during startup. Diagnostics: ${JSON.stringify(current)}`
      );
    }
    if (
      current.catalogLoading === "true"
      || (current.catalogState !== null && current.catalogState !== "uninitialized")
    ) return current;
    return undefined;
  }, timeoutMs, () => (
    "Windows real-user Session Catalog request did not start after Workspace restoration or selection. "
    + `Diagnostics: ${JSON.stringify(latestObservation)}`
  ));
  return {
    ...observation,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10
  };
}

function catalogStateFromText(text, itemCount) {
  if (text.includes("Session 索引正在恢复")) return "fallback-recovering";
  if (text.includes("Session 索引暂时不可用")) return "fallback";
  if (text.includes("正在建立 Session 目录")) return "rebuilding";
  if (text.includes("未能读取全部 Session")) return "incomplete-empty";
  if (text.includes("这个工作区还没有会话")) return "ready-empty";
  if (itemCount > 0) return "ready";
  return undefined;
}

function explicitCatalogState(observation) {
  if (observation.catalogState === "uninitialized") return undefined;
  if (observation.catalogRebuilding === "true") {
    return observation.catalogState === "fallback" ? "fallback-recovering" : "rebuilding";
  }
  if (observation.catalogState === "ready") {
    if (observation.catalogIncomplete === "true" && observation.itemCount === 0) return "incomplete-empty";
    return observation.itemCount > 0 ? "ready" : "ready-empty";
  }
  if (observation.catalogState === "fallback") return "fallback";
  if (observation.catalogState !== undefined && observation.catalogState !== null) return undefined;
  return catalogStateFromText(observation.text, observation.itemCount);
}

export async function waitForCatalogState(
  window,
  expectedSessionIdentity,
  timeoutMs = REAL_USER_CATALOG_TIMEOUT_MS,
  diagnostics = {}
) {
  const startedAt = performance.now();
  const workspaceGroup = window.getByTestId("workspace-group").first();
  await workspaceGroup.waitFor({ state: "visible", timeout: timeoutMs });
  let latestObservation;
  const observation = await waitForCatalogCondition(async () => {
    const current = await workspaceGroup.evaluate((element, expectedIdentity) => {
      const text = element.textContent ?? "";
      const conversationIdentities = [...element.querySelectorAll('[data-testid="conversation-row"]')]
        .map((row) => row.getAttribute("data-conversation-id"));
      const sessionIdentities = conversationIdentities
        .filter((identity) => identity?.startsWith("session:"));
      return {
        catalogIncomplete: element.getAttribute("data-catalog-incomplete"),
        catalogItemCount: element.getAttribute("data-catalog-item-count"),
        catalogRebuilding: element.getAttribute("data-catalog-rebuilding"),
        catalogRevision: element.getAttribute("data-catalog-revision"),
        catalogSource: element.getAttribute("data-catalog-source"),
        catalogState: element.getAttribute("data-catalog-state"),
        catalogVisibleCount: element.getAttribute("data-catalog-visible-count"),
        hasExpectedSession: expectedIdentity ? sessionIdentities.includes(expectedIdentity) : true,
        itemCount: sessionIdentities.length,
        provisionalItemCount: conversationIdentities
          .filter((identity) => identity?.startsWith("provisional:")).length,
        sessionIdentities,
        text
      };
    }, expectedSessionIdentity);
    latestObservation = {
      catalogIncomplete: current.catalogIncomplete ?? null,
      catalogItemCount: current.catalogItemCount ?? null,
      catalogRebuilding: current.catalogRebuilding ?? null,
      catalogRevision: current.catalogRevision ?? null,
      catalogSource: current.catalogSource ?? null,
      catalogState: current.catalogState ?? null,
      catalogVisibleCount: current.catalogVisibleCount ?? null,
      hasExpectedSession: current.hasExpectedSession,
      itemCount: current.itemCount,
      provisionalItemCount: current.provisionalItemCount,
      state: explicitCatalogState(current) ?? null,
      visibleSessionIdentityFingerprints: (current.sessionIdentities ?? []).map(fingerprintSessionIdentity)
    };
    if (current.catalogState === "unavailable" || current.text.includes("Session 目录暂不可用")) {
      throw new Error("Windows real-user Session Catalog became unavailable.");
    }
    if (current.text.includes("Agent request acknowledgement timed out")) {
      throw new Error("Windows real-user Session Catalog exposed an acknowledgement timeout.");
    }
    if (!current.hasExpectedSession || current.text.includes("正在加载 Session")) return undefined;
    if (!expectedSessionIdentity && current.provisionalItemCount > 0) {
      return { itemCount: current.itemCount, state: "creating" };
    }
    const explicitState = explicitCatalogState(current);
    return explicitState ? { itemCount: current.itemCount, state: explicitState } : undefined;
  }, timeoutMs, async () => {
    const [expectedSessionFile, sessionCatalogDiscovery] = await Promise.all([
      diagnostics.inspectExpectedSessionFile?.(),
      diagnostics.inspectSessionCatalogDiscovery?.()
    ]);
    return "Windows real-user Session Catalog did not return an explicit state. "
      + `Diagnostics: ${JSON.stringify({
        ...latestObservation,
        launchIndex: diagnostics.launchIndex ?? null,
        expectedSessionIdentityFingerprint: fingerprintSessionIdentity(expectedSessionIdentity),
        ...(expectedSessionFile === undefined ? {} : { expectedSessionFile }),
        ...(sessionCatalogDiscovery === undefined ? {} : { sessionCatalogDiscovery })
      })}`;
  });
  const durationMs = performance.now() - startedAt;
  if (durationMs > timeoutMs) throw new Error(`Windows real-user Session Catalog exceeded ${timeoutMs}ms.`);
  return { ...observation, durationMs: Math.round(durationMs * 10) / 10 };
}

export function shouldCreateInitialRealUserSession({ catalog, expectedSessionIdentity, launchIndex }) {
  return launchIndex === 0
    && expectedSessionIdentity === undefined
    && catalog.itemCount === 0
    && catalog.state !== "creating";
}

async function waitForCatalogCondition(action, timeoutMs, failureMessage) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    const result = await action();
    if (result !== undefined && result !== false) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`${await failureMessage()} after ${timeoutMs}ms.`);
}
