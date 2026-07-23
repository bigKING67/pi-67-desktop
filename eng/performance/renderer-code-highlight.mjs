export function createTypeScriptMarkdown(lineCount, label) {
  if (!Number.isInteger(lineCount) || lineCount < 1) throw new Error("lineCount must be a positive integer.");
  const lines = Array.from({ length: lineCount }, (_, index) => (
    `export const ${label}_${index} = { index: ${index}, value: (${index} * 17) % 997 } as const;`
  ));
  return `\`\`\`typescript\n${lines.join("\n")}\n\`\`\``;
}

export async function assertHighlightResourcesDeferred(page) {
  const resources = await highlightResources(page);
  const loaded = Object.entries(resources).filter((entry) => entry[1]).map((entry) => entry[0]);
  if (loaded.length > 0) {
    throw new Error(`Welcome loaded deferred highlighting resources: ${loaded.join(", ")}.`);
  }
  return loaded.length;
}

export async function measureCodeHighlight(page, { markdown, messageId, expectedLineCount }) {
  const result = await page.evaluate(({ fixtureMarkdown, fixtureMessageId, lineCount }) => new Promise((resolve, reject) => {
    const control = globalThis.__pi67Performance;
    if (!control) {
      reject(new Error("Renderer performance control is unavailable."));
      return;
    }
    const longTasks = [];
    const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const longTaskObserver = longTaskSupported
      ? new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)))
      : undefined;
    longTaskObserver?.observe({ type: "longtask" });

    const started = performance.now();
    const deadline = started + 15_000;
    control.showMarkdown(fixtureMarkdown, fixtureMessageId);
    const observe = () => {
      const codeBlock = document.querySelector(".code-block");
      if (codeBlock?.getAttribute("data-highlight-state") === "fallback") {
        longTaskObserver?.disconnect();
        reject(new Error(`Code highlighting fell back to plain text: ${codeBlock.getAttribute("data-highlight-error") ?? "unknown error"}.`));
        return;
      }
      const renderedLineCount = document.querySelectorAll(".code-line").length;
      const highlightedLineCount = Number(codeBlock?.getAttribute("data-highlighted-line-count") ?? 0);
      const virtualWindowValid = lineCount <= 200
        ? renderedLineCount === lineCount
        : renderedLineCount > 0 && renderedLineCount < lineCount;
      if (highlightedLineCount === lineCount && virtualWindowValid && document.querySelector(".composer-shell")) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          longTaskObserver?.disconnect();
          resolve({
            durationMs: performance.now() - started,
            longTaskSupported,
            maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
            highlightedLineCount,
            renderedLineCount
          });
        }));
        return;
      }
      if (performance.now() >= deadline) {
        longTaskObserver?.disconnect();
        const fallbackLength = codeBlock?.querySelector("pre > code")?.textContent?.length ?? 0;
        const messageLength = document.querySelector(".message-card .message-content")?.textContent?.length ?? 0;
        reject(new Error(
          `Code highlight timed out: highlighted=${highlightedLineCount}, rendered=${renderedLineCount}, expected=${lineCount}, `
          + `codeBlock=${Boolean(codeBlock)}, fallbackLength=${fallbackLength}, messageLength=${messageLength}.`
        ));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }), { fixtureMarkdown: markdown, fixtureMessageId: messageId, lineCount: expectedLineCount });

  const resources = await highlightResources(page);
  const missing = Object.entries(resources).filter((entry) => !entry[1]).map((entry) => entry[0]);
  if (missing.length > 0) {
    const evidence = await page.evaluate(() => ({
      resources: performance.getEntriesByType("resource").map((entry) => entry.name),
      marks: performance.getEntriesByName("pi67-code-highlight-resources", "mark").map((entry) => entry.detail)
    }));
    throw new Error(`Highlighted code did not load: ${missing.join(", ")}; evidence=${JSON.stringify(evidence).slice(0, 2_000)}.`);
  }
  if (!result.longTaskSupported) throw new Error("Chromium Long Tasks API is unavailable for the code stress scenario.");
  return result;
}

async function highlightResources(page) {
  return page.evaluate(() => {
    const workerResources = performance.getEntriesByName("pi67-code-highlight-resources", "mark")
      .flatMap((entry) => Array.isArray(entry.detail) ? entry.detail : []);
    const names = [...performance.getEntriesByType("resource").map((entry) => entry.name), ...workerResources].map((name) => {
      try {
        return new URL(name).pathname.split("/").at(-1) ?? "";
      } catch {
        return "";
      }
    });
    return {
      highlighter: names.some((name) => /^code-highlighter(?:\.worker)?-[^.]+\.js$/u.test(name)),
      language: names.some((name) => /^typescript-[^.]+\.js$/u.test(name)),
      wasm: names.some((name) => /^wasm-[^.]+\.js$/u.test(name))
    };
  });
}
