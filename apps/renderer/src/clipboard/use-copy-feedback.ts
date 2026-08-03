import { useCallback, useEffect, useRef, useState } from "react";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";

export type CopyFeedbackState = "idle" | "copied" | "failed";

export function useCopyFeedback(options: { failureTitle?: string } = {}) {
  const [copyState, setCopyState] = useState<CopyFeedbackState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failureTitle = options.failureTitle ?? messages.transcript.copyFailed;

  useEffect(() => () => {
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
  }, []);

  const copyText = useCallback(async (text: string): Promise<boolean> => {
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      return true;
    } catch (error) {
      setCopyState("failed");
      publishNotification({
        level: "error",
        title: failureTitle,
        message: error instanceof Error ? error.message : messages.runtime.unknownError
      });
      return false;
    } finally {
      resetTimer.current = setTimeout(() => setCopyState("idle"), 1_800);
    }
  }, [failureTitle]);

  return { copyState, copyText } as const;
}
