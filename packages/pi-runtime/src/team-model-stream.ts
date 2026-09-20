import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { isRuntimeError } from "@pi67/domain";

/** Preserve Pi events and transport; cancellation must not depend on provider cooperation. */
export function streamWithTeamLease(transport: StreamFn, args: Parameters<StreamFn>, assertValid: () => void, refresh?: (signal: AbortSignal) => Promise<void>) {
  const [model, context, options] = args;
  const output = createAssistantMessageEventStream();
  const controller = new AbortController();
  const refreshController = new AbortController();
  let refreshing = false;
  let lastRefresh = performance.now();
  const callerSignal = options?.signal;
  let closed = false;
  let latest: AssistantMessage | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    closed = true;
    clearInterval(timer);
    refreshController.abort();
    callerSignal?.removeEventListener("abort", abortFromCaller);
  };
  const fail = (error: unknown, aborted = false) => {
    if (closed) return;
    cleanup();
    controller.abort();
    const usage = latest?.usage;
    output.push({ type: "error", reason: aborted ? "aborted" : "error", error: {
      role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: [], stopReason: aborted ? "aborted" : "error",
      errorMessage: aborted ? "Team model request was cancelled." : error instanceof Error ? error.message : "Team model request failed.",
      usage: usage ? { ...usage, cost: { ...usage.cost } } : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
        totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    } });
  };
  const abortFromCaller = () => fail(undefined, true);
  const check = () => {
    if (closed) return false;
    if (callerSignal?.aborted) { abortFromCaller(); return false; }
    try { assertValid(); return true; } catch (error) { fail(error); return false; }
  };
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (!check()) return output;
  timer = setInterval(() => {
    if (!check() || !refresh || refreshing || performance.now() - lastRefresh < 60_000) return;
    refreshing = true;
    lastRefresh = performance.now();
    void (async () => {
      try { await refresh(refreshController.signal); check(); }
      catch (error) {
        if (isRuntimeError(error) && error.code === "RUNTIME_NOT_READY" && error.recoverable
          && error.details?.kind === "enterprise-transport-unavailable") check();
        else fail(error);
      } finally { refreshing = false; }
    })();
  }, 1_000);
  timer.unref?.();
  void (async () => {
    try {
      const source = await transport(model, context, { ...options, signal: controller.signal });
      if (!check()) return;
      for await (const event of source) {
        if (!check()) break;
        latest = event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial;
        output.push(event);
        if (event.type === "done" || event.type === "error") { cleanup(); return; }
      }
      if (!closed) fail(new Error("Team model stream ended without a terminal result."));
    } catch (error) { fail(error); }
  })();
  return output;
}
