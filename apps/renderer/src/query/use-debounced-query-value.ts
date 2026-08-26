import { useEffect, useState } from "react";

export function useDebouncedQueryValue(
  value: string,
  enabled: boolean,
  delayMs = 180
): string | undefined {
  const [settled, setSettled] = useState<string>();

  useEffect(() => {
    setSettled(undefined);
    if (!enabled) return;
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, enabled, value]);

  return enabled ? settled : undefined;
}
