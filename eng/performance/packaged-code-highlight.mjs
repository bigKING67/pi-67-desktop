export async function measurePackagedCodeHighlight(application, window, sessionPath, expectedLineCount) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, sessionPath);
  return withTimeout(window.evaluate((lineCount) => new Promise((resolve, reject) => {
    const button = document.querySelector('[aria-label="导入 Pi session 到当前工作区"]');
    if (!(button instanceof HTMLButtonElement)) {
      reject(new Error("Pi session file action is unavailable."));
      return;
    }
    const started = performance.now();
    button.click();
    const observe = () => {
      const codeBlock = document.querySelector(".code-block");
      const state = codeBlock?.getAttribute("data-highlight-state");
      if (state === "fallback") {
        reject(new Error(`Packaged code highlighting fell back: ${codeBlock?.getAttribute("data-highlight-error") ?? "unknown error"}.`));
        return;
      }
      const highlightedLineCount = Number(codeBlock?.getAttribute("data-highlighted-line-count") ?? 0);
      const renderedLineCount = document.querySelectorAll(".code-line").length;
      const virtualized = renderedLineCount > 0 && renderedLineCount < lineCount;
      if (state === "ready" && highlightedLineCount === lineCount && virtualized) {
        requestAnimationFrame(() => resolve(performance.now() - started));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }), expectedLineCount), 20_000);
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
