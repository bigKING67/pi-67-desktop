import { expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PiRuntimePromptActions } from "./pi-runtime-prompt-actions.js";
import { RuntimePromptAttachments } from "./runtime-prompt-attachments.js";
import { RuntimeResponseTimings } from "./runtime-response-timing.js";

type Options = ConstructorParameters<typeof PiRuntimePromptActions>[0];
function fixture(streaming = false) {
  let now = 0;
  const responseTimings = new RuntimeResponseTimings(() => now);
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const prompt = vi.fn(async () => {
    now = 40;
    for (const listener of listeners) listener({ type: "agent_start" });
    now = 80;
    for (const listener of listeners) listener({ type: "message_update", assistantMessageEvent: {
      type: "text_delta", delta: "private fixture"
    } } as AgentSessionEvent);
    now = 100;
    responseTimings.emitted([{ assistantMessageEvent: { type: "text_delta", delta: "private fixture" } }]);
  });
  const session = { isStreaming: streaming, prompt,
    subscribe: (listener: (event: AgentSessionEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); }
  } as unknown as AgentSession;
  const upsertCurrent = vi.fn(async () => { now = 110; });
  const options = {
    responseTimings,
    assertWritable: vi.fn(async () => { now = 10; }),
    sessionBindings: { requireSession: () => session } as Options["sessionBindings"],
    sessionCatalog: { upsertCurrent } as unknown as Options["sessionCatalog"],
    configurationReload: { assertReady: vi.fn(async () => { now = 20; }), apply: vi.fn(async () => { now = 120; }) } as unknown as Options["configurationReload"],
    promptAttachments: new RuntimePromptAttachments(undefined),
    generateSemanticTitle: vi.fn()
  };
  return { actions: new PiRuntimePromptActions(options), options, prompt, listeners, responseTimings, upsertCurrent };
}

it("instruments the real attachment submit seam without changing prompt delivery or persistence", async () => {
  const f = fixture();
  await f.actions.submit("private prompt");
  expect(f.prompt).toHaveBeenCalledWith("private prompt", { images: [] });
  expect(f.upsertCurrent).toHaveBeenCalledWith("session-updated");
  expect(f.listeners.size).toBe(0);
  expect(f.responseTimings.snapshot().receipts[0]).toEqual({
    sequence: 1, status: "resolved", elapsedMs: 120,
    sessionCheckedMs: 10, configurationReadyMs: 20, sdkPromptInvokedMs: 20,
    sdkAgentStartedMs: 40, firstTextMs: 80, firstTextEmittedMs: 100
  });
  expect(JSON.stringify(f.responseTimings.snapshot())).not.toContain("private");
});

it("does not attribute an existing stream to a queued submission", async () => {
  const f = fixture(true);
  await f.actions.submit("queued");
  expect(f.responseTimings.snapshot().receipts[0]).toEqual({
    sequence: 1, status: "queued", elapsedMs: 20, sessionCheckedMs: 10, configurationReadyMs: 20
  });
  expect(f.listeners.size).toBe(0);
});

it("retains incomplete cancellation and rejection without leaking listeners or error text", async () => {
  const f = fixture();
  const controller = new AbortController(); controller.abort();
  await expect(f.actions.submit("secret", undefined, controller.signal)).rejects.toThrow();
  expect(f.responseTimings.snapshot().receipts[0]).toEqual({ sequence: 1, status: "cancelled", elapsedMs: 0 });
  f.prompt.mockRejectedValueOnce(new Error("private failure"));
  await expect(f.actions.submit("secret")).rejects.toThrow("private failure");
  expect(f.responseTimings.snapshot().receipts[1]).toMatchObject({ status: "rejected", sdkPromptInvokedMs: 20 });
  expect(f.responseTimings.snapshot().receipts[1]?.firstTextMs).toBeUndefined();
  expect(f.listeners.size).toBe(0);
  expect(JSON.stringify(f.responseTimings.snapshot())).not.toMatch(/private|secret/u);
});
