import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { _electron as electron } from "@playwright/test";
import {
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit
} from "../packaging/controlled-shutdown-fixture.ts";
import { locateWorkspaceSessionImportAction } from "./packaged-workspace-menu.mjs";

export async function measurePackagedApplicationLaunch({
  executablePath,
  profile,
  agentDir,
  expectWelcome,
  inheritedEnvironment
}) {
  const started = performance.now();
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    env: { ...inheritedEnvironment, NODE_ENV: "test", PI_CODING_AGENT_DIR: agentDir }
  });
  const electronHandshakeMs = performance.now() - started;
  try {
    const window = await application.firstWindow();
    const firstWindowMs = performance.now() - started;
    await window.waitForLoadState("domcontentloaded");
    const domContentLoadedMs = performance.now() - started;
    const workspaceAction = window.getByRole("button", { name: "选择工作区" });
    let workspaceActionVisibleMs;
    if (expectWelcome) {
      await workspaceAction.waitFor({ state: "visible", timeout: 15_000 });
      workspaceActionVisibleMs = performance.now() - started;
      await waitUntilEnabled(workspaceAction, 15_000);
    } else {
      await window.getByTestId("workspace-add").waitFor({ state: "visible", timeout: 15_000 });
    }
    const durationMs = performance.now() - started;
    return {
      application,
      window,
      durationMs,
      phases: {
        electronHandshakeMs,
        firstWindowMs,
        domContentLoadedMs,
        workspaceActionVisibleMs: workspaceActionVisibleMs ?? durationMs
      }
    };
  } catch (error) {
    await application.close();
    throw error;
  }
}

export async function initializePackagedRuntime(application, window, workspace) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, workspace);
  const started = performance.now();
  await window.getByRole("button", { name: "选择工作区" }).click();
  await waitForRuntimeReady(window, 30_000);
  await window.locator(".conversation-region").waitFor({ state: "visible", timeout: 10_000 });
  return performance.now() - started;
}

export async function measurePackagedCommandPaletteFirstOpen(window, platform) {
  const measurement = await window.evaluate((hostPlatform) => new Promise((resolve, reject) => {
    const started = performance.now();
    const deadline = started + 5_000;
    let feedbackMs;
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "k",
      code: "KeyK",
      metaKey: hostPlatform === "darwin",
      ctrlKey: hostPlatform !== "darwin"
    }));
    const observe = () => {
      if (feedbackMs === undefined) {
        const feedbackVisible = [...document.querySelectorAll('[role="status"]')]
          .some((element) => element.textContent?.includes("正在加载命令面板"));
        if (feedbackVisible) feedbackMs = performance.now() - started;
      }
      if (document.querySelector('[role="dialog"][aria-label="命令面板"]')) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const readyMs = performance.now() - started;
          resolve({ feedbackMs: feedbackMs ?? readyMs, readyMs });
        }));
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error("Command Palette did not become visible within 5000ms."));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }), platform);
  const dialog = window.getByRole("dialog", { name: "命令面板" });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  await window.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5_000 });
  return measurement;
}

export async function measureActiveExtensionCommandClose(
  application,
  window,
  platform,
  childPidPath,
  lifecyclePath,
  agentHostPid
) {
  let childPid;
  try {
    await window.keyboard.press(platform === "darwin" ? "Meta+k" : "Control+k");
    const command = window.getByRole("option", {
      name: "/hold-open Start a controlled child process until Pi shuts down"
    });
    await command.waitFor({ state: "visible", timeout: 10_000 });
    await command.click();
    childPid = await readPositiveProcessId(childPidPath);
    if (!isProcessAlive(childPid)) throw new Error("Controlled Extension child exited before measurement.");

    const started = performance.now();
    await application.close();
    const durationMs = performance.now() - started;
    await waitForProcessExit(childPid);
    await waitForProcessExit(agentHostPid);
    const lifecycle = await readFile(lifecyclePath, "utf8");
    if (!lifecycle.includes("shutdown:quit")) {
      throw new Error("Pi Runtime did not emit session_shutdown(reason=quit) during close measurement.");
    }
    return durationMs;
  } finally {
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
  }
}

export async function measureRealPiSessionProjection(application, window, sessionPath, expectedMessageCount) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, sessionPath);
  const action = await locateWorkspaceSessionImportAction(window);
  return withTimeout(action.evaluate((importAction, messageCount) => new Promise((resolve, reject) => {
    const started = performance.now();
    const deadline = started + 15_000;
    let maxTranscriptMessageCount = 0;
    let fixtureMessageWasVisible = false;
    const projectionTimeline = [];
    let previousProjectionKey = "";
    importAction.click();
    const observe = () => {
      const transcriptMessageCount = Number(document.querySelector('[data-transcript-region="true"]')?.getAttribute("data-message-count") ?? 0);
      const fixtureMessageVisible = document.querySelector('[data-testid="message-card"] [data-testid="message-content"]')?.textContent
        ?.includes("Pi-67 restore fixture") ?? false;
      const olderPageAvailable = Boolean(document.querySelector('[data-testid="load-older-messages"]'));
      maxTranscriptMessageCount = Math.max(maxTranscriptMessageCount, transcriptMessageCount);
      fixtureMessageWasVisible ||= fixtureMessageVisible;
      const projectionKey = `${transcriptMessageCount}:${fixtureMessageVisible}:${olderPageAvailable}`;
      if (projectionKey !== previousProjectionKey && projectionTimeline.length < 24) {
        projectionTimeline.push({
          elapsedMs: Math.round(performance.now() - started),
          transcriptMessageCount,
          fixtureMessageVisible,
          olderPageAvailable
        });
        previousProjectionKey = projectionKey;
      }
      if (
        transcriptMessageCount === messageCount
        && fixtureMessageVisible
        && olderPageAvailable
        && document.querySelector('[data-testid="composer-shell"]')
      ) {
        requestAnimationFrame(() => resolve(performance.now() - started));
        return;
      }
      if (performance.now() >= deadline) {
        const diagnostic = {
          composerVisible: Boolean(document.querySelector('[data-testid="composer-shell"]')),
          conversationVisible: Boolean(document.querySelector(".conversation-region")),
          transcriptSessionId: document.querySelector('[data-transcript-region="true"]')?.getAttribute("data-session-id"),
          maxTranscriptMessageCount,
          fixtureMessageWasVisible,
          projectionTimeline,
          statusText: [...document.querySelectorAll('[role="status"], [role="alert"], [aria-label^="当前状态："]')]
            .map((element) => element.textContent?.trim())
            .filter(Boolean)
            .slice(0, 12),
          bodyText: document.body.innerText.slice(0, 800)
        };
        reject(new Error(
          `Pi session projection timed out: transcriptMessages=${transcriptMessageCount}, `
          + `fixtureMessageVisible=${fixtureMessageVisible}, olderPageAvailable=${olderPageAvailable}, `
          + `diagnostic=${JSON.stringify(diagnostic)}.`
        ));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }), expectedMessageCount), 20_000, "Packaged Pi session projection");
}

export async function waitForRuntimeReady(window, timeoutMs) {
  try {
    await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    const state = await window.locator('[aria-label^="当前状态："], [role="alert"], [role="status"]').allTextContents();
    throw new Error(`Pi SDK did not recover: ${state.join(" | ").slice(0, 1_000)}`, { cause: error });
  }
}

async function waitUntilEnabled(locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the workspace action to become enabled.");
}

async function withTimeout(operation, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
