import { createElement, useEffect, useState } from "react";

/**
 * A running Operation's age as `m:ss`. It owns its once-per-second tick so only this leaf
 * re-renders; callers key it by `startedAt` so a new Operation starts from a fresh reading.
 */
export function ElapsedClock({ className, startedAt }: { className: string | undefined; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  return createElement("small", { "aria-hidden": true, className }, `· ${formatElapsedClock(now - startedAt)}`);
}

export function formatElapsedClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
