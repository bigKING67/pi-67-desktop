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

    let focusedTarget: HTMLElement | undefined;
    // The element that requested the jump (usually the index button). Until the
    // message takes focus, any other focus move is the user's and ends retries.
    const invoker = document.activeElement;
    const focusTarget = () => {
      const selector = row.kind === "process-group"
        ? `[data-transcript-row-key="${CSS.escape(row.key)}"]`
        : `[data-message-id="${CSS.escape(highlightedMessageId)}"]`;
      const target = regionRef.current?.querySelector<HTMLElement>(
        selector
      );
      if (!target || target.getClientRects().length === 0 || !focusMessage) return;
      const activeElement = document.activeElement;
      if (focusedTarget?.isConnected && activeElement !== focusedTarget) return;
      if (!focusedTarget && activeElement !== invoker && activeElement !== document.body
        && activeElement !== target) return;
      if (activeElement !== target) target.focus({ preventScroll: true });
      if (document.activeElement === target) focusedTarget = target;
    };
    const observer = new MutationObserver(focusTarget);
    if (focusMessage && regionRef.current) {
      observer.observe(regionRef.current, {
        attributes: true,
        attributeFilter: ["style"],
        childList: true,
        subtree: true
      });
    }
    let focusFrame: number | undefined;
    // Locating a message can remount the virtualized list; its rows may take
    // many frames to return on a busy machine, and the observer above may be
    // watching the replaced region, so retry by time rather than a frame count.
    const focusDeadline = performance.now() + FOCUS_RETRY_MS;
    let stableFrames = 0;
    const stabilizeFocus = () => {
      focusTarget();
      // Keep a few frames after success so a re-render that drops focus is restored.
      if (focusedTarget && document.activeElement === focusedTarget) stableFrames += 1;
      if (stableFrames < 4 && performance.now() < focusDeadline) focusFrame = window.requestAnimationFrame(stabilizeFocus);
    };
    if (focusMessage) focusFrame = window.requestAnimationFrame(stabilizeFocus);
    const timeout = window.setTimeout(() => setHighlightedMessageId((current) => (
      current === highlightedMessageId ? undefined : current
    )), 1_800);
    return () => {
      observer.disconnect();
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(timeout);
    };
  }, [focusMessage, highlightedMessageId, regionRef, rows, setHighlightedMessageId, virtuosoRef]);
}

const FOCUS_RETRY_MS = 2_000;
