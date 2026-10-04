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
  let initialSessionSurface;
  let stage = "session-surface";
  try {
    // A fresh Session Intent starts Pi only when the controlled prompt is sent.
    // Model hydration, the active Operation and its real child are verified next.
    await ready.or(failed).or(intent).first().waitFor({ state: "visible", timeout: timeoutMs });
    if (await failed.isVisible()) throw new Error("Pi SDK entered the failed runtime phase.");
    initialSessionSurface = await intent.isVisible() ? "new-session-intent" : "runtime-ready";
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
      const workspacePickerVisible = [...document.querySelectorAll("button")].some((button) => (
        button.textContent?.trim() === "选择工作区"
        && button.getBoundingClientRect().width > 0
        && button.getBoundingClientRect().height > 0
      ));
      return {
        acknowledgementTimedOut: bodyText.includes("Agent request acknowledgement timed out"),
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
        workspacePickerVisible
      };
    }), new Promise(resolve => {
      timer = setTimeout(() => resolve({ unavailable: true }), 1_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
