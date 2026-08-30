import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  findTranscriptRowIndexByMessageId,
  type TranscriptRow
} from "./transcript-rows.js";

interface TranscriptMessageFocusOptions {
  focusMessage: boolean;
  highlightedMessageId: string | undefined;
  regionRef: RefObject<HTMLDivElement | null>;
  rows: TranscriptRow[];
  setHighlightedMessageId: Dispatch<SetStateAction<string | undefined>>;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

export function useTranscriptMessageFocus({
  focusMessage,
  highlightedMessageId,
  regionRef,
  rows,
  setHighlightedMessageId,
  virtuosoRef
}: TranscriptMessageFocusOptions): void {
  useEffect(() => {
    if (!highlightedMessageId) return;
    const index = findTranscriptRowIndexByMessageId(rows, highlightedMessageId);
    if (index < 0) return;
    const row = rows[index]!;
    virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });

    const focusTarget = () => {
      const selector = row.kind === "process-group"
        ? `[data-transcript-row-key="${CSS.escape(row.key)}"]`
        : `[data-message-id="${CSS.escape(highlightedMessageId)}"]`;
      const target = regionRef.current?.querySelector<HTMLElement>(
        selector
      );
      if (!target || target.getClientRects().length === 0) return false;
      if (focusMessage) target.focus({ preventScroll: true });
      return !focusMessage || document.activeElement === target;
    };
    const observer = new MutationObserver(() => {
      if (focusTarget()) observer.disconnect();
    });
    if (!focusTarget() && regionRef.current) {
      observer.observe(regionRef.current, {
        attributes: true,
        attributeFilter: ["style"],
        childList: true,
        subtree: true
      });
    }
    const timeout = window.setTimeout(() => setHighlightedMessageId((current) => (
      current === highlightedMessageId ? undefined : current
    )), reducedMotion() ? 300 : 1_800);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [focusMessage, highlightedMessageId, regionRef, rows, setHighlightedMessageId, virtuosoRef]);
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
