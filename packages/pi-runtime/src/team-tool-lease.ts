import { isRuntimeError } from "@pi67/domain";

export interface TeamToolLease {
  assertValid(): void;
  retain(): () => void;
}

/** One renewal flight per model's active Tool group, including parallel calls. */
export function createTeamToolLease(assertCurrent: () => void, refresh: (signal: AbortSignal) => Promise<void>, runSignal?: AbortSignal): TeamToolLease {
  let users = 0;
  let failure: Error | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    controller?.abort();
    controller = undefined;
    runSignal?.removeEventListener("abort", stop);
  };
  const assertValid = () => {
    if (failure) throw failure;
    runSignal?.throwIfAborted();
    assertCurrent();
  };
  const fail = (error: unknown) => {
    failure = error instanceof Error ? error : new Error("Team Tool authorization refresh failed.");
    stop();
  };
  return { assertValid, retain() {
    assertValid();
    users++;
    if (users === 1) {
      const active = new AbortController();
      controller = active;
      let refreshing = false;
      let lastRefresh = performance.now();
      runSignal?.addEventListener("abort", stop, { once: true });
      timer = setInterval(() => {
        try { assertValid(); } catch (error) { fail(error); return; }
        if (refreshing || performance.now() - lastRefresh < 60_000) return;
        refreshing = true;
        lastRefresh = performance.now();
        void (async () => {
          try { await refresh(active.signal); }
          catch (error) {
            if (active.signal.aborted) return;
            if (!(isRuntimeError(error) && error.code === "RUNTIME_NOT_READY" && error.recoverable
              && error.details?.kind === "enterprise-transport-unavailable")) { fail(error); return; }
          } finally { refreshing = false; }
          if (!active.signal.aborted) {
            try { assertValid(); } catch (error) { fail(error); }
          }
        })();
      }, 1_000);
      timer.unref?.();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--users === 0) stop();
    };
  } };
}
