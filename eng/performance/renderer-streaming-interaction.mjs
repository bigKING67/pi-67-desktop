import { MAX_PROJECTED_TEXT_BYTES } from "../../packages/domain/dist/index.mjs";

function createStreamingInteractionFixture() {
  const block = (index) => `\n\n### stream-batch-${index}\n\n`
    + "Synthetic **streaming** content with `inline code` and a [reference](https://example.invalid).\n\n"
    + "| Item | Value |\n| --- | --- |\n| Alpha | 123 |\n| Beta | 456 |\n\n"
    + "- First bounded synthetic item\n- Second bounded synthetic item\n";
  return {
    seed: Array.from({ length: 40 }, (_, index) => block(`seed-${index}`)).join(""),
    batches: Array.from({ length: 60 }, (_, index) => block(index)),
    intervalMs: 50,
    inputIntervalMs: 120
  };
}

// Extends the already-active short-text stream in measure-renderer. The fixture
// stays local to the MessagePort harness; no Provider or user Session is used.
export async function measureStreamingInteraction(page) {
  const fixture = createStreamingInteractionFixture();
  if (Buffer.byteLength(fixture.seed + fixture.batches.join("")) + 256 > MAX_PROJECTED_TEXT_BYTES) {
    throw new Error("Concurrent streaming fixture exceeds the projected text budget.");
  }
  return page.evaluate(async ({ seed, batches, intervalMs, inputIntervalMs }) => {
    const control = globalThis.__pi67Performance;
    const textarea = document.querySelector('[data-testid="composer-shell"] textarea');
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!control?.diagnostics().streaming || !(textarea instanceof HTMLTextAreaElement)
      || !(scroller instanceof HTMLElement)) {
      throw new Error("Concurrent streaming fixture is unavailable.");
    }
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    const liveText = () => Array.from(document.querySelectorAll('[data-markdown-mode="streaming"]'))
      .map((element) => element.textContent ?? "").join("\n");
    const waitForMarker = async (marker) => {
      const deadline = performance.now() + 10_000;
      while (!liveText().includes(marker)) {
        if (performance.now() > deadline) throw new Error(`Streaming marker missing: ${marker}`);
        await frame();
      }
    };
    await control.emitStreamBatch(seed);
    await waitForMarker("stream-batch-seed-39");
    await frame();
    const inputToFrame = [];
    const scheduledInputToFrame = [];
    const batchSchedulingDelay = [];
    const frames = [];
    const longTasks = [];
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask" });
    let running = true;
    let frameId;
    const started = performance.now();
    const duration = batches.length * intervalMs;
    let expectedDraft = "";
    const animate = (timestamp) => {
      if (!running) return;
      frames.push(timestamp);
      // Stay within the live answer while exercising reading/scroll layout.
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight
        - (80 + 80 * Math.sin((timestamp - started) / 180));
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    try {
      await Promise.all([
        (async () => {
          for (let index = 0; index < batches.length; index += 1) {
            const due = started + (index + 1) * intervalMs;
            await sleep(due - performance.now());
            batchSchedulingDelay.push(Math.max(0, performance.now() - due));
            await control.emitStreamBatch(batches[index]);
          }
        })(),
        (async () => {
          for (let index = 0; index < Math.floor(duration / inputIntervalMs); index += 1) {
            const due = started + (index + 0.5) * inputIntervalMs;
            await sleep(due - performance.now());
            const dispatched = performance.now();
            expectedDraft += String.fromCharCode(97 + index % 26);
            textarea.focus({ preventScroll: true });
            textarea.select();
            textarea.setRangeText(expectedDraft);
            textarea.dispatchEvent(new InputEvent("input", {
              bubbles: true, inputType: "insertText", data: expectedDraft.at(-1)
            }));
            await frame();
            inputToFrame.push(performance.now() - dispatched);
            scheduledInputToFrame.push(performance.now() - due);
          }
        })()
      ]);
      await waitForMarker(`stream-batch-${batches.length - 1}`);
      await frame();
      const headings = new Set(Array.from(document.querySelectorAll('[data-markdown-mode="streaming"] h3')).map((element) => element.textContent));
      if (textarea.value !== expectedDraft || batches.some((_, index) => !headings.has(`stream-batch-${index}`))) {
        throw new Error("Concurrent streaming lost draft input or output markers.");
      }
      for (const entry of observer.takeRecords()) longTasks.push(entry.duration);
      return {
        inputToFrame, scheduledInputToFrame, batchSchedulingDelay, frames,
        markdownWorkerUsed: document.querySelector('[data-markdown-mode="streaming"][data-markdown-parser="worker"]') !== null,
        maxLongTask: Math.max(0, ...longTasks),
        elapsedMs: performance.now() - started,
        inputCount: inputToFrame.length,
        batchCount: batches.length,
        markdownBytes: new TextEncoder().encode(seed + batches.join("")).byteLength
      };
    } finally {
      running = false;
      cancelAnimationFrame(frameId);
      observer.disconnect();
    }
  }, fixture);
}
