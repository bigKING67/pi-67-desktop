const MIB = 1024 * 1024;

export function createRendererMemoryMetrics(input, summarizeMetric) {
  return [
    summarizeMetric({
      id: "rendererWelcomeUsedHeap",
      label: "Welcome renderer used JS heap after explicit GC",
      unit: "MiB",
      samples: input.welcomeHeap,
      evidenceLevel: "browser",
      method: "CDP Runtime.getHeapUsage after page.requestGC and two animation frames"
    }),
    summarizeMetric({
      id: "rendererRestored100UsedHeap",
      label: "Restored Session with 100 visible messages used JS heap",
      unit: "MiB",
      samples: input.restoredHeap,
      evidenceLevel: "browser",
      method: "CDP heap usage after Session bootstrap, explicit GC, and two animation frames"
    }),
    summarizeMetric({
      id: "rendererLoaded1kUsedHeap",
      label: "Loaded 1,000-message transcript used JS heap",
      unit: "MiB",
      samples: input.loadedHeap,
      evidenceLevel: "browser",
      method: "Nine older-page prepends, then explicit GC and CDP heap sampling"
    }),
    summarizeMetric({
      id: "rendererAfter10SwitchesUsedHeap",
      label: "Renderer used JS heap after 10 Session switches",
      unit: "MiB",
      samples: input.switchedHeap,
      evidenceLevel: "browser",
      method: "Ten 1,000-message Session bootstrap replacements, current message cards mounted, then explicit GC and CDP heap sampling"
    }),
    summarizeMetric({
      id: "rendererLoaded1kHeapDelta",
      label: "Retained JS heap added by loading 900 older messages",
      unit: "MiB",
      samples: deltas(input.loadedHeap, input.restoredHeap),
      budget: 6,
      evidenceLevel: "browser",
      method: "Per-sample loaded-1k heap minus restored-100 heap after explicit GC"
    }),
    summarizeMetric({
      id: "rendererAfter10SwitchesHeapDelta",
      label: "Retained JS heap after 10 Session switches",
      unit: "MiB",
      samples: deltas(input.switchedHeap, input.restoredHeap),
      budget: 8,
      evidenceLevel: "browser",
      method: "Per-sample settled post-switch heap minus first restored-Session heap after explicit GC"
    }),
    summarizeMetric({
      id: "rendererLoaded1kDomNodes",
      label: "DOM nodes with 1,000 settled messages loaded",
      unit: "nodes",
      samples: input.loadedNodes,
      budget: 1_000,
      evidenceLevel: "browser",
      method: "CDP Memory.getDOMCounters after Virtuoso prepends and explicit GC"
    }),
    summarizeMetric({
      id: "rendererAfter10SwitchesDomNodes",
      label: "DOM nodes after 10 Session switches",
      unit: "nodes",
      samples: input.switchedNodes,
      budget: 800,
      evidenceLevel: "browser",
      method: "CDP Memory.getDOMCounters after ten settled bootstrap replacements and explicit GC"
    })
  ];
}

export async function createRendererMemoryProbe(context, page) {
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  return {
    async sample() {
      await page.requestGC();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const [heap, dom] = await Promise.all([
        session.send("Runtime.getHeapUsage"),
        session.send("Memory.getDOMCounters")
      ]);
      return {
        usedHeapMiB: heap.usedSize / MIB,
        documents: dom.documents,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners
      };
    },
    async dispose() {
      await session.detach();
    }
  };
}

export async function loadAllOlderMessages(page, expectedCount) {
  while (await transcriptMessageCount(page) < expectedCount) {
    const before = await transcriptMessageCount(page);
    await page.locator('[data-testid="virtuoso-scroller"]').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByTestId("load-older-messages").click();
    try {
      await page.waitForFunction((previous) => {
        const region = document.querySelector('[data-transcript-region="true"]');
        return Number(region?.getAttribute("data-message-count") ?? 0) > previous;
      }, before, { timeout: 10_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => {
        const region = document.querySelector('[data-transcript-region="true"]');
        const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
        return {
          messageCount: Number(region?.getAttribute("data-message-count") ?? 0),
          transcriptError: region?.querySelector('[role="alert"]')?.textContent ?? undefined,
          loadOlderLabel: region?.querySelector('[data-testid="load-older-messages"]')?.textContent ?? undefined,
          scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : undefined,
          fixture: globalThis.__pi67Performance?.diagnostics()
        };
      });
      throw new Error(`Older message projection stalled: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
  }
}

export async function switchPerformanceSessions(page, count, messageCount) {
  for (let index = 0; index < count; index += 1) {
    const marker = `switch-${index}`;
    await page.evaluate(async ({ nextMarker, nextMessageCount }) => {
      await globalThis.__pi67Performance?.switchSession(nextMarker, nextMessageCount);
    }, { nextMarker: marker, nextMessageCount: messageCount });
    await page.waitForFunction(({ expected, expectedMessageCount }) => {
      const region = document.querySelector('[data-transcript-region="true"]');
      const cards = [...(region?.querySelectorAll('[data-testid="message-card"]') ?? [])];
      return region?.getAttribute("data-session-id") === `performance-${expected}`
        && Number(region.getAttribute("data-message-count") ?? 0) === Math.min(100, expectedMessageCount)
        && cards.length > 0
        && cards.every((card) => card.getAttribute("data-message-id")?.startsWith(`${expected}-message-`));
    }, { expected: marker, expectedMessageCount: messageCount });
  }
}

function transcriptMessageCount(page) {
  return page.locator('[data-transcript-region="true"]').evaluate((element) => (
    Number(element.getAttribute("data-message-count") ?? 0)
  ));
}

function deltas(values, baseline) {
  return values.map((value, index) => Math.max(0, value - baseline[index]));
}
