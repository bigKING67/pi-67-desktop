import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent, emitMockAgentEvent, installMockDesktopBridge,
  replaceMockSessionProjection, setMockConversationMessages, waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

const operationId = "markdown-worker-operation";
const prefix = "Synthetic paragraph with **bold** and `code`.\n\n".repeat(220);

async function openStream(page: Page) {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, []);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await emitMockAgentEvent(page, {
    type: "operation.started", payload: { operation: {
      operationId, kind: "prompt", lifecycle: "running", cancellable: true,
      sessionId: "session-test", sessionFileIdentity: "session-file-fixture-demo", sessionGeneration: 1,
      startedAt: Date.now()
    } }
  }, { operationId });
}

async function append(page: Page, delta: string) {
  await emitMockAgentEvent(page, {
    type: "turn.streamBatch", payload: { events: [{ assistantMessageEvent: { type: "text_delta", delta } }] }
  }, { operationId });
}

test("parses long streams in a worker while preserving late references, GFM and blocked images", async ({ page }) => {
  await openStream(page);
  await append(page, prefix + "\n[Late reference][target]\n\n![Blocked](https://example.invalid/image.png)\n");
  const live = page.locator('[data-markdown-mode="streaming"]');
  await expect(live).toHaveAttribute("data-markdown-parser", "worker");
  await append(page, "\n| Name | Value |\n| --- | --- |\n| Test | 42 |\n\n[target]: https://example.invalid/reference\n");
  await expect(live.getByRole("link", { name: "Late reference" })).toHaveAttribute("href", "https://example.invalid/reference");
  await expect(live.getByRole("cell", { name: "42", exact: true })).toHaveCount(1);
  await expect(live.locator("img")).toHaveCount(0);
  await append(page, "\n\nNewest final marker &copy;");
  await expect(live).toContainText("Newest final marker ©");
  await setMockConversationMessages(page, [{
    id: "authoritative-settled", role: "assistant", createdAt: 1,
    parts: [{ type: "text", text: prefix + "Authoritative settlement" }]
  }]);
  await emitMockAgentEvent(page, {
    type: "conversation.changed", payload: { sessionId: "session-test", reason: "settled" }
  }, { operationId });
  await expect(page.getByTestId("message-content")).toContainText("Authoritative settlement");
  await expect(page.locator('[data-markdown-mode="streaming"]')).toHaveCount(0);
  await expect(page.locator('[data-markdown-parser="worker"]')).toHaveCount(0);
});

test("discards an active worker projection when a different Session is installed", async ({ page }) => {
  await page.addInitScript(() => {
    const counts = { created: 0, terminated: 0 };
    Object.assign(window, { __markdownWorkerCounts: counts });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly tracked: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.tracked = String(url).includes("streaming-markdown-parser.worker");
        if (this.tracked) counts.created += 1;
      }
      override terminate() {
        if (this.tracked) counts.terminated += 1;
        super.terminate();
      }
    };
  });
  await openStream(page);
  await append(page, prefix + "old-session-marker");
  await expect(page.locator('[data-markdown-parser="worker"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const counts = (window as unknown as { __markdownWorkerCounts: { created: number; terminated: number } }).__markdownWorkerCounts;
    return counts.created - counts.terminated;
  })).toBe(1);
  await append(page, "\nqueued-old-marker");
  await replaceMockSessionProjection(page, "replacement-session", [
    { id: "replacement-message", role: "assistant", parts: [{ type: "text", text: "Replacement document" }], createdAt: 1 }
  ]);
  await expect(page.getByTestId("message-content")).toContainText("Replacement document");
  await expect(page.locator('[data-markdown-parser="worker"]')).toHaveCount(0);
  await expect(page.locator('[data-transcript-region="true"]')).not.toContainText("queued-old-marker");
  await expect.poll(() => page.evaluate(() => {
    const counts = (window as unknown as { __markdownWorkerCounts: { created: number; terminated: number } }).__markdownWorkerCounts;
    // Development StrictMode may create and dispose an initial Worker first.
    return counts.created > 0 && counts.created === counts.terminated;
  })).toBe(true);
});


test("falls back to current synchronous Markdown when the worker cannot load", async ({ page }) => {
  await page.route("**/streaming-markdown-parser.worker-*.js", (route) => route.abort());
  const failure = page.waitForEvent("console", (message) => message.text().includes("Streaming Markdown parser unavailable"));
  await openStream(page);
  await append(page, prefix + "fallback-first-marker");
  await failure;
  await append(page, "\n\nfallback-latest-marker");
  const live = page.locator('[data-markdown-mode="streaming"]');
  await expect(live).toContainText("fallback-latest-marker");
  await expect(live).not.toHaveAttribute("data-markdown-parser", "worker");
});
