import { startControlledPrompt } from "./controlled-provider-interaction.mjs";
import { parseInitializationObservations } from "./windows-real-user-initialization.mjs";
import { parsePromptAcknowledgementObservations } from "./windows-real-user-failure-diagnostics.mjs";

export const WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS = 60_000;

export async function startWindowsSyntheticControlledOperation(
  window,
  processOutput,
  scaleFactor,
  timeoutMs = WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS
) {
  const ready = window.locator('[data-runtime-phase="ready"]');
  const failed = window.locator('[data-runtime-phase="failed"]');
  const intent = window.getByTestId("new-session-intent");
  // Workspace opening deliberately stops after its 5s Catalog decision budget.
  // A later authoritative empty Catalog permits the explicit New action; an
  // unknown, rebuilding, incomplete or failed Catalog must never pass this gate.
  const emptyWorkspace = window.locator(
    '.application-shell[data-agent-connected="true"][data-workspace-open-pending="false"]'
    + ':has([data-runtime-phase="stopped"])'
    + ':has([data-testid="workspace-group"][data-catalog-state="ready"]'
    + '[data-catalog-loading="false"][data-catalog-rebuilding="false"]'
    + '[data-catalog-incomplete="false"][data-catalog-error="false"][data-catalog-item-count="0"])'
  ).getByRole("button", { name: "新建对话", exact: true });
  const deadline = performance.now() + timeoutMs;
  const remaining = () => {
    const duration = deadline - performance.now();
    if (duration <= 0) throw new Error("Session surface deadline exceeded.");
    return duration;
  };
  let initialSessionSurface;
  let stage = "session-surface";
  try {
    // A fresh Session Intent starts Pi only when the controlled prompt is sent.
    // Model hydration, the active Operation and its real child are verified next.
    const sessionSurface = ready.or(failed).or(intent);
    await sessionSurface.or(emptyWorkspace).first().waitFor({ state: "visible", timeout: remaining() });
    if (await failed.isVisible()) throw new Error("Pi SDK entered the failed runtime phase.");
    if (await emptyWorkspace.isVisible()) {
      initialSessionSurface = "ready-empty-workspace";
      stage = "new-session-intent";
      await emptyWorkspace.click({ timeout: remaining() });
      await intent.or(failed).first().waitFor({ state: "visible", timeout: remaining() });
      if (await failed.isVisible()) throw new Error("Pi SDK entered the failed runtime phase.");
    } else {
      initialSessionSurface = await intent.isVisible() ? "new-session-intent" : "runtime-ready";
    }
    stage = "controlled-prompt";
    await startControlledPrompt(window);
  } catch (error) {
    const diagnostic = {
      stage,
      initialSessionSurface,
      initialization: parseInitializationObservations(processOutput()),
      promptAcknowledgement: parsePromptAcknowledgementObservations(processOutput()),
      surface: await inspectWindowsSyntheticRuntimeSurface(window).catch(() => ({ unavailable: true }))
    };
    throw new Error(
      `Scale ${scaleFactor}: ${stage} failed: ${error instanceof Error ? error.message : String(error)}. `
      + `Diagnostics: ${JSON.stringify(diagnostic)}`,
      { cause: error }
    );
  }
  return initialSessionSurface;
}

export async function inspectWindowsSyntheticRuntimeSurface(window) {
  let timer;
  try {
    return await Promise.race([window.evaluate(() => {
      const bodyText = document.body.innerText;
      const runtimeStatus = document.querySelector("[data-runtime-phase]");
      const shell = document.querySelector(".application-shell");
      const catalog = document.querySelector('[data-testid="workspace-group"]');
      const workspacePickerVisible = [...document.querySelectorAll("button")].some((button) => (
        button.textContent?.trim() === "选择工作区"
        && button.getBoundingClientRect().width > 0
        && button.getBoundingClientRect().height > 0
      ));
      return {
        acknowledgementTimedOut: bodyText.includes("Agent request acknowledgement timed out"),
        agentConnected: shell?.getAttribute("data-agent-connected") ?? null,
        catalog: Object.fromEntries(["state", "loading", "rebuilding", "incomplete", "error", "item-count"]
          .map(key => [key, catalog?.getAttribute(`data-catalog-${key}`) ?? null])),
        conversationRowCount: document.querySelectorAll('[data-testid="conversation-row"]').length,
        newSessionIntentVisible: Boolean(document.querySelector('[data-testid="new-session-intent"]')?.getClientRects().length),
        notificationTitles: [...document.querySelectorAll("[data-notification-id] strong")]
          .slice(0, 4).map(node => node.textContent?.slice(0, 160) ?? ""),
        promptAuthorityNotReady: bodyText.includes("Pi 会话身份尚未就绪"),
        firstPromptNotSent: bodyText.includes("首条消息尚未发送"),
        runtimePhase: runtimeStatus?.getAttribute("data-runtime-phase") ?? null,
        title: document.title,
        url: location.href,
        workspaceOpenFailed: bodyText.includes("无法打开工作区"),
        workspaceOpenPending: shell?.getAttribute("data-workspace-open-pending") ?? null,
        workspacePickerVisible
      };
    }), new Promise(resolve => {
      timer = setTimeout(() => resolve({ unavailable: true }), 1_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
