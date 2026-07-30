import { locateWorkspaceSessionImportAction } from "./packaged-workspace-menu.mjs";

export async function measurePackagedCodeHighlight(application, window, sessionPath, expectedLineCount) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, sessionPath);
  const action = await locateWorkspaceSessionImportAction(window);
  return withTimeout(action.evaluate((importAction, lineCount) => new Promise((resolve, reject) => {
    const started = performance.now();
    const deadline = started + 20_000;
    importAction.click();
    const observe = () => {
      const codeBlock = document.querySelector('[data-testid="code-block"]');
      const state = codeBlock?.getAttribute("data-highlight-state");
      if (state === "fallback") {
        reject(new Error(`Packaged code highlighting fell back: ${codeBlock?.getAttribute("data-highlight-error") ?? "unknown error"}.`));
        return;
      }
      const highlightedLineCount = Number(codeBlock?.getAttribute("data-highlighted-line-count") ?? 0);
      const renderedLineCount = document.querySelectorAll('[data-testid="code-line"]').length;
      const virtualized = renderedLineCount > 0 && renderedLineCount < lineCount;
      if (state === "ready" && highlightedLineCount === lineCount && virtualized) {
        requestAnimationFrame(() => resolve(performance.now() - started));
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`Packaged code highlighting timed out: ${JSON.stringify({
          state,
          highlightedLineCount,
          renderedLineCount,
          transcriptMessageCount: Number(document.querySelector('[data-transcript-region="true"]')?.getAttribute("data-message-count") ?? 0),
          codeBlockCount: document.querySelectorAll('[data-testid="code-block"]').length,
          statusText: [...document.querySelectorAll('[role="status"], [role="alert"]')]
            .map((element) => element.textContent?.trim())
            .filter(Boolean)
            .slice(0, 12),
          bodyText: document.body.innerText.slice(0, 800)
        })}.`));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }), expectedLineCount), 25_000);
}

async function withTimeout(operation, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Packaged code highlighting exceeded ${timeoutMs}ms.`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
