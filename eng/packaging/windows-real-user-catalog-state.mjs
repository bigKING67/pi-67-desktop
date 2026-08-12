import { fingerprintSessionIdentity } from "./windows-installer-identity.mjs";

export const REAL_USER_CATALOG_TIMEOUT_MS = 5_000;

const POLL_INTERVAL_MS = 50;

function catalogStateFromText(text, itemCount) {
  if (text.includes("Session 索引正在恢复")) return "fallback-recovering";
  if (text.includes("Session 索引暂时不可用")) return "fallback";
  if (text.includes("正在建立 Session 目录")) return "rebuilding";
  if (text.includes("未能读取全部 Session")) return "incomplete-empty";
  if (text.includes("这个工作区还没有会话")) return "ready-empty";
  if (itemCount > 0) return "ready";
  return undefined;
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
        hasExpectedSession: expectedIdentity ? sessionIdentities.includes(expectedIdentity) : true,
        itemCount: sessionIdentities.length,
        provisionalItemCount: conversationIdentities
          .filter((identity) => identity?.startsWith("provisional:")).length,
        sessionIdentities,
        text
      };
    }, expectedSessionIdentity);
    latestObservation = {
      hasExpectedSession: current.hasExpectedSession,
      itemCount: current.itemCount,
      provisionalItemCount: current.provisionalItemCount,
      state: catalogStateFromText(current.text, current.itemCount) ?? null,
      text: current.text,
      visibleSessionIdentityFingerprints: (current.sessionIdentities ?? []).map(fingerprintSessionIdentity)
    };
    if (current.text.includes("Session 目录暂不可用")) {
      throw new Error("Windows real-user Session Catalog became unavailable.");
    }
    if (current.text.includes("Agent request acknowledgement timed out")) {
      throw new Error("Windows real-user Session Catalog exposed an acknowledgement timeout.");
    }
    if (!current.hasExpectedSession || current.text.includes("正在加载 Session")) return undefined;
    if (!expectedSessionIdentity && current.provisionalItemCount > 0) {
      return { itemCount: current.itemCount, state: "creating" };
    }
    const explicitState = catalogStateFromText(current.text, current.itemCount);
    return explicitState ? { itemCount: current.itemCount, state: explicitState } : undefined;
  }, timeoutMs, async () => {
    const expectedSessionFile = diagnostics.inspectExpectedSessionFile
      ? await diagnostics.inspectExpectedSessionFile()
      : undefined;
    return "Windows real-user Session Catalog did not return an explicit state. "
      + `Diagnostics: ${JSON.stringify({
        ...latestObservation,
        launchIndex: diagnostics.launchIndex ?? null,
        expectedSessionIdentityFingerprint: fingerprintSessionIdentity(expectedSessionIdentity),
        ...(expectedSessionFile === undefined ? {} : { expectedSessionFile })
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
