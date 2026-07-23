import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import {
  createReport,
  droppedFrameRate,
  enforceReport,
  printReport,
  resolveSampleCount,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";
import {
  assertHighlightResourcesDeferred,
  createTypeScriptMarkdown,
  measureCodeHighlight
} from "./renderer-code-highlight.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const samples = resolveSampleCount();
const previewPort = await availablePort();
const previewUrl = `http://127.0.0.1:${previewPort}`;
const outputPath = process.env.PI67_PERF_RENDERER_OUTPUT
  ?? join(root, "artifacts/performance", `renderer-${process.platform}-${process.arch}.json`);
const coldCodeLineCount = 2_000;
const warmCodeLineCount = 1_800;
const scrollSweepCount = 3;
const coldCodeMarkdown = createTypeScriptMarkdown(coldCodeLineCount, "cold_fixture");
const warmCodeMarkdown = createTypeScriptMarkdown(warmCodeLineCount, "warm_fixture");

const preview = startPreview();
let browser;

try {
  await waitForPreview();
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const projectionSamples = [];
  const composerSamples = [];
  const scrollSamples = [];
  const streamingSamples = [];
  const deferredHighlightResourceSamples = [];
  const coldCodeHighlightSamples = [];
  const warmCodeHighlightSamples = [];
  const codeHighlightLongTaskSamples = [];
  const longCodeComposerSamples = [];

  for (let index = 0; index < samples; index += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 920 } });
    const page = await context.newPage();
    await installSystemBridge(page);
    await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible" });
    deferredHighlightResourceSamples.push(await assertHighlightResourcesDeferred(page));
    await attachMockAgent(page, 1_000);

    projectionSamples.push(await measureProjection(page));
    composerSamples.push(await measureComposerPaint(page, index));
    scrollSamples.push((await measureScroll(page)) * 100);
    streamingSamples.push(await measureStreamingRate(page));
    const coldHighlight = await measureCodeHighlight(page, {
      markdown: coldCodeMarkdown,
      messageId: `cold-code-${index}`,
      expectedLineCount: coldCodeLineCount
    });
    coldCodeHighlightSamples.push(coldHighlight.durationMs);
    codeHighlightLongTaskSamples.push(coldHighlight.maxLongTaskMs);
    const warmHighlight = await measureCodeHighlight(page, {
      markdown: warmCodeMarkdown,
      messageId: `warm-code-${index}`,
      expectedLineCount: warmCodeLineCount
    });
    warmCodeHighlightSamples.push(warmHighlight.durationMs);
    codeHighlightLongTaskSamples.push(warmHighlight.maxLongTaskMs);
    longCodeComposerSamples.push(await measureComposerPaint(page, `long-code-${index}`));
    await context.close();
  }

  const metrics = [
    summarizeMetric({
      id: "messageProjection",
      label: "1,000-message first usable projection",
      unit: "ms",
      samples: projectionSamples,
      budget: 1_500,
      evidenceLevel: "browser",
      method: "Production Vite bundle, MessagePort mock, first message and composer visible",
      limitations: ["Does not include Pi JSONL disk parsing or Pi SDK session restoration."]
    }),
    summarizeMetric({
      id: "composerInputToPaint",
      label: "Composer input to next animation frame",
      unit: "ms",
      samples: composerSamples,
      budget: 50,
      evidenceLevel: "browser",
      method: "Native textarea input event to next requestAnimationFrame"
    }),
    summarizeMetric({
      id: "transcriptScrollDroppedFrames",
      label: "1,000-message transcript scroll dropped-frame rate",
      unit: "%",
      samples: scrollSamples,
      budget: 1,
      evidenceLevel: "browser",
      method: `${scrollSweepCount} consecutive one-second full-range requestAnimationFrame scrolls; per-sweep dropped-frame rates averaged`,
      limitations: ["Headless Chromium is not a packaged Electron compositor or physical display measurement."]
    }),
    summarizeMetric({
      id: "streamingRendererUpdates",
      label: "Streaming renderer DOM update rate",
      unit: "/s",
      samples: streamingSamples,
      budget: 20,
      evidenceLevel: "browser",
      method: "Twenty target-scheduled 50 ms MessagePort batches with distinct visible live-message mutations",
      limitations: ["Agent Host batching is covered separately by StreamBatcher unit tests."]
    }),
    summarizeMetric({
      id: "welcomeHighlightResources",
      label: "Welcome highlighting resources loaded",
      unit: "resources",
      samples: deferredHighlightResourceSamples,
      budget: 0,
      evidenceLevel: "browser",
      method: "Production resource timing entries before Agent Host attachment; code-highlighter, Shiki WASM, and TypeScript grammar chunks must all remain absent"
    }),
    summarizeMetric({
      id: "coldLongCodeHighlight",
      label: "Cold lazy TypeScript code highlight",
      unit: "ms",
      samples: coldCodeHighlightSamples,
      evidenceLevel: "browser",
      method: `${coldCodeLineCount.toLocaleString("en-US")} lines, ${Buffer.byteLength(coldCodeMarkdown).toLocaleString("en-US")} UTF-8 bytes; includes worker, Shiki WASM, TypeScript grammar lazy loading, tokenization, and first virtualized viewport`,
      limitations: ["Informational until representative long-code data establishes a release budget."]
    }),
    summarizeMetric({
      id: "warmLongCodeHighlight",
      label: "Warm TypeScript code highlight",
      unit: "ms",
      samples: warmCodeHighlightSamples,
      evidenceLevel: "browser",
      method: `${warmCodeLineCount.toLocaleString("en-US")} lines, ${Buffer.byteLength(warmCodeMarkdown).toLocaleString("en-US")} UTF-8 bytes; reuses the loaded worker, WASM engine, and grammar and renders a bounded virtualized viewport`,
      limitations: ["Informational until representative long-code data establishes a release budget."]
    }),
    summarizeMetric({
      id: "longCodeHighlightMaxLongTask",
      label: "Maximum main-thread long task during long-code highlighting",
      unit: "ms",
      samples: codeHighlightLongTaskSamples,
      evidenceLevel: "browser",
      method: "Chromium Long Tasks API across cold and warm long-code projections",
      limitations: ["Informational; this exposes synchronous tokenizer risk but does not sample a physical user's keystroke during the task."]
    }),
    summarizeMetric({
      id: "longCodeComposerInputToPaint",
      label: "Composer input to paint after long-code projection",
      unit: "ms",
      samples: longCodeComposerSamples,
      budget: 50,
      evidenceLevel: "browser",
      method: "Native textarea input event to next animation frame after the warm long-code block is fully rendered",
      limitations: ["Measures post-highlight responsiveness; in-task blocking is represented separately by longCodeHighlightMaxLongTask."]
    })
  ];
  const report = await createReport({
    root,
    suite: "renderer",
    metrics,
    unverified: []
  });
  await writeReport(outputPath, report);
  printReport(outputPath, report);
  enforceReport(report);
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
}

function startPreview() {
  const vite = join(root, "apps/renderer/node_modules/.bin", process.platform === "win32" ? "vite.CMD" : "vite");
  const child = spawn(
    vite,
    ["preview", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"],
    {
      cwd: join(root, "apps/renderer"),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    }
  );
  let errorOutput = "";
  child.stderr?.on("data", (chunk) => {
    errorOutput = `${errorOutput}${String(chunk)}`.slice(-4_000);
  });
  child.once("exit", (code) => {
    if (code && code !== 0 && code !== 143) console.error(`Renderer preview exited with ${code}: ${errorOutput}`);
  });
  return child;
}

async function availablePort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate a renderer preview port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPreview() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(previewUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${previewUrl}.`);
}

async function installSystemBridge(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "performance" }),
          connectAgentHost: async () => undefined,
          selectWorkspace: async () => "/tmp/pi67-performance-workspace",
          selectSessionFile: async () => undefined,
          saveDiagnostics: async () => undefined,
          showNotification: async () => undefined,
          requestOpenExternal: async () => false,
          getUpdateState: async () => ({
            phase: "disabled",
            channel: "unsigned-preview",
            currentVersion: "performance",
            detail: "Performance fixture"
          }),
          checkForUpdates: async () => ({
            phase: "disabled",
            channel: "unsigned-preview",
            currentVersion: "performance",
            detail: "Performance fixture"
          }),
          onAgentHostFailed: () => () => undefined
        }
      }
    });
  });
}

async function attachMockAgent(page, messageCount) {
  await page.evaluate((count) => {
    const messages = Array.from({ length: count }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `Performance message ${index}: bounded transcript content.` }],
      createdAt: index
    }));
    const snapshot = {
      sessionId: "performance-session",
      sessionPath: "/tmp/pi67-performance-session.jsonl",
      cwd: "/tmp/pi67-performance-workspace",
      streaming: false,
      messages,
      models: [{ provider: "fixture", id: "performance", label: "Performance fixture", configured: true, reasoning: true }],
      selectedModel: { provider: "fixture", id: "performance" },
      thinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium", "high"],
      steeringQueue: [],
      followUpQueue: [],
      tree: [],
      resources: [],
      stats: { tokens: 0, cost: 0, contextPercent: 0 }
    };
    const channel = new MessageChannel();
    let messageSequence = 0;
    const sendEvent = (type, payload) => {
      messageSequence += 1;
      channel.port2.postMessage({
        protocolVersion: 1,
        kind: "event",
        messageId: `performance-event-${messageSequence}`,
        sequence: messageSequence,
        timestamp: Date.now(),
        event: { type, payload }
      });
    };
    channel.port2.onmessage = (event) => {
      const envelope = event.data;
      if (!envelope?.requestId) return;
      const type = envelope.command?.type;
      const data = type === "session.list" || type === "command.list" ? [] : snapshot;
      channel.port2.postMessage({
        protocolVersion: 1,
        kind: "response",
        messageId: `performance-response-${Date.now()}`,
        requestId: envelope.requestId,
        timestamp: Date.now(),
        response: { ok: true, data }
      });
    };
    channel.port2.start();
    globalThis.__pi67Performance = {
      beginStreaming() {
        snapshot.streaming = true;
        sendEvent("session.snapshot", snapshot);
      },
      emitStreamBatch(delta) {
        sendEvent("turn.streamBatch", {
          events: [{
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta }
          }]
        });
      },
      showMarkdown(markdown, messageId) {
        snapshot.streaming = false;
        snapshot.messages = [{
          id: messageId,
          role: "assistant",
          parts: [{ type: "text", text: markdown }],
          createdAt: Date.now()
        }];
        sendEvent("session.snapshot", snapshot);
      }
    };
    window.postMessage({ source: "pi67-preload", type: "agent-port" }, "*", [channel.port1]);
  }, messageCount);
}

async function measureProjection(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const button = document.querySelector(".welcome-action");
    if (!(button instanceof HTMLButtonElement)) {
      reject(new Error("Workspace action is unavailable."));
      return;
    }
    const started = performance.now();
    button.click();
    const deadline = started + 5_000;
    const observe = () => {
      if (document.querySelector(".message-card") && document.querySelector(".composer-shell")) {
        requestAnimationFrame(() => resolve(performance.now() - started));
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error("1,000-message projection timed out."));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }));
}

async function measureComposerPaint(page, index) {
  return page.locator(".composer-shell textarea").evaluate((element, sampleIndex) => new Promise((resolve) => {
    const textarea = element;
    requestAnimationFrame(() => {
      const started = performance.now();
      textarea.focus();
      textarea.select();
      textarea.setRangeText(`Performance input ${sampleIndex}`);
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
      requestAnimationFrame(() => resolve(performance.now() - started));
    });
  }), index);
}

async function measureScroll(page) {
  const sweeps = await page.evaluate((sweepCount) => new Promise((resolve, reject) => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!(scroller instanceof HTMLElement) || scroller.scrollHeight <= scroller.clientHeight) {
      reject(new Error("Virtualized transcript scroller is unavailable."));
      return;
    }
    const renderedMessages = document.querySelectorAll(".message-card").length;
    if (renderedMessages >= 1_000) {
      reject(new Error(`Transcript rendered ${renderedMessages} message cards instead of virtualizing.`));
      return;
    }
    const results = [];
    const runSweep = () => {
      scroller.scrollTop = 0;
      const frames = [];
      let started;
      const step = (timestamp) => {
        started ??= timestamp;
        frames.push(timestamp);
        const progress = Math.min(1, (timestamp - started) / 1_000);
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * progress;
        if (progress < 1) requestAnimationFrame(step);
        else {
          results.push(frames);
          if (results.length < sweepCount) requestAnimationFrame(runSweep);
          else resolve(results);
        }
      };
      requestAnimationFrame(step);
    };
    runSweep();
  }), scrollSweepCount);
  return sweeps.reduce((total, timestamps) => total + droppedFrameRate(timestamps), 0) / sweeps.length;
}

async function measureStreamingRate(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const control = globalThis.__pi67Performance;
    const transcript = document.querySelector(".transcript-region");
    if (!control || !transcript) {
      reject(new Error("Streaming performance fixture is unavailable."));
      return;
    }
    void (async () => {
      control.beginStreaming();
      await new Promise((afterSnapshot) => requestAnimationFrame(() => requestAnimationFrame(afterSnapshot)));
      let updates = 0;
      let visibleText = "";
      const observer = new MutationObserver(() => {
        const messages = transcript.querySelectorAll(".message-card");
        const currentText = messages.item(messages.length - 1)?.querySelector(".message-content")?.textContent ?? "";
        if (currentText.includes("token-") && currentText !== visibleText) {
          visibleText = currentText;
          updates += 1;
        }
      });
      observer.observe(transcript, { childList: true, characterData: true, subtree: true });
      const started = performance.now();
      for (let index = 0; index < 20; index += 1) {
        const delay = Math.max(0, started + ((index + 1) * 50) - performance.now());
        await new Promise((continueBatch) => setTimeout(continueBatch, delay));
        control.emitStreamBatch(`token-${index} `);
      }
      await new Promise((afterPaint) => requestAnimationFrame(() => requestAnimationFrame(afterPaint)));
      observer.disconnect();
      resolve(updates / ((performance.now() - started) / 1_000));
    })().catch(reject);
  }));
}
