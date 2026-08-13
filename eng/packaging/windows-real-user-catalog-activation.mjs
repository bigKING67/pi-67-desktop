import { readSelectedConversationIdentity } from "./windows-installed-application-lifecycle.mjs";

export const REAL_USER_RUNTIME_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 50;

export async function activateCatalogSession(
  window,
  expectedSessionIdentity,
  timeoutMs = REAL_USER_RUNTIME_TIMEOUT_MS
) {
  const deadline = performance.now() + timeoutMs;
  const conversation = window.getByLabel("Pi conversation");
  const rows = window.locator('[data-testid="conversation-row"]');
  let targetSessionIdentity = expectedSessionIdentity;
  let activationRequested = false;
  let observation = { provisionalRowCount: 0, rowCount: 0, sessionRowCount: 0 };

  while (performance.now() <= deadline) {
    if (await conversation.isVisible()) {
      const selectedIdentity = await readSelectedConversationIdentity(window);
      if (targetSessionIdentity && selectedIdentity === targetSessionIdentity) {
        return targetSessionIdentity;
      }
      if (!targetSessionIdentity && selectedIdentity?.startsWith("session:")) {
        return selectedIdentity;
      }
    }

    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const identity = await row.getAttribute("data-conversation-id");
      if (
        (targetSessionIdentity && identity === targetSessionIdentity)
        || (!targetSessionIdentity && identity?.startsWith("session:"))
      ) {
        targetSessionIdentity = identity;
        if (!activationRequested) {
          await row.click({ timeout: Math.max(1, Math.ceil(deadline - performance.now())) });
          activationRequested = true;
        }
        break;
      }
    }

    observation = await rows.evaluateAll((visibleRows) => ({
      provisionalRowCount: visibleRows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("provisional:"))
        .length,
      rowCount: visibleRows.length,
      sessionRowCount: visibleRows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("session:"))
        .length
    }));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Windows real-user lifecycle could not activate a Catalog-backed Session: ${JSON.stringify(observation)}`
  );
}
