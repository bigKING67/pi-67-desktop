import { useCallback, useEffect, useRef, useState } from "react";
import type { ListRange, VirtuosoHandle } from "react-virtuoso";
import { useConversationReadPositionStore } from "./conversation-read-position-store.js";
import type { TranscriptRow } from "./transcript-rows.js";

interface TranscriptScrollControllerOptions {
  historical: boolean;
  readKey: string | undefined;
  rows: readonly TranscriptRow[];
}

export function useTranscriptScrollController({
  historical,
  readKey,
  rows
}: TranscriptScrollControllerOptions) {
  const [atBottom, setAtBottom] = useState(true);
  const [unseenRowCount, setUnseenRowCount] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const followLatestRef = useRef(true);
  const followScrollFrameRef = useRef(0);
  const scrollerCleanupRef = useRef<(() => void) | undefined>(undefined);
  // Current values for listeners bound once to the scroller element.
  const anchorInputsRef = useRef({ historical, readKey, rows });
  anchorInputsRef.current = { historical, readKey, rows };
  const anchorFrameRef = useRef(0);
  const restoreFrameRef = useRef(0);
  const previousRowsRef = useRef<{
    readKey: string | undefined;
    count: number;
    lastKey: string | undefined;
  } | undefined>(undefined);
  const savedReadPosition = readKey
    ? useConversationReadPositionStore.getState().positions[readKey]
    : undefined;
  const restoreRef = useRef<{ readKey: string | undefined; historical: boolean; index: number; pending: boolean; inFlight: boolean } | undefined>(undefined);
  if (!restoreRef.current || restoreRef.current.readKey !== readKey || restoreRef.current.historical !== historical) {
    const index = !historical && savedReadPosition && !savedReadPosition.atBottom
      ? rows.findIndex((row) => row.key === savedReadPosition.anchorKey) : -1;
    restoreRef.current = { readKey, historical, index, pending: index >= 0, inFlight: false };
    followLatestRef.current = savedReadPosition?.atBottom ?? true;
  }
  const restoredAnchorRowIndex = restoreRef.current.index;

  const restoreMeasuredAnchor = useCallback(() => {
    const restore = restoreRef.current;
    const scroller = scrollerRef.current;
    if (!restore?.pending || !scroller || scroller.clientHeight === 0) return false;
    if (restore.inFlight) return true;
    if (!restoreFrameRef.current) restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = 0;
      if (restore !== restoreRef.current || !restore.pending || !virtuosoRef.current || scrollerRef.current !== scroller) return;
      restore.inFlight = true;
      virtuosoRef.current.scrollIntoView({
        index: restore.index,
        align: "start",
        behavior: "auto",
        // A partly visible row still needs alignment with the reading viewport.
        calculateViewLocation: ({ itemTop, viewportTop, locationParams }) => (
          Math.abs(itemTop - viewportTop) <= 1 ? null : locationParams
        ),
        done: () => {
          if (restore !== restoreRef.current || !restore.pending) return;
          restore.pending = false;
          observeVisibleAnchor(scroller, anchorInputsRef.current);
        }
      });
    });
    return true;
  }, []);

  const bindScroller = useCallback((scroller: HTMLElement | Window | null) => {
    scrollerCleanupRef.current?.();
    scrollerCleanupRef.current = undefined;
    scrollerRef.current = null;
    if (!(scroller instanceof HTMLElement)) return;

    scrollerRef.current = scroller;
    let previousScrollTop = scroller.scrollTop;
    let userScrollIntentUntil = 0;
    let pointerScrollActive = false;
    const ownerDocument = scroller.ownerDocument;
    const armUserScrollIntent = () => {
      if (restoreRef.current) restoreRef.current.pending = false;
      userScrollIntentUntil = performance.now() + USER_SCROLL_INTENT_WINDOW_MS;
    };
    const observeAnchorAfterScroll = () => {
      if (anchorFrameRef.current) return;
      anchorFrameRef.current = requestAnimationFrame(() => {
        anchorFrameRef.current = 0;
        if (!restoreRef.current?.pending) observeVisibleAnchor(scroller, anchorInputsRef.current);
      });
    };
    const observeScrollDirection = () => {
      observeAnchorAfterScroll();
      const nextScrollTop = scroller.scrollTop;
      // Reflow and Virtuoso measurement can lower scrollTop without user input.
      if (
        nextScrollTop < previousScrollTop
        && (pointerScrollActive || performance.now() <= userScrollIntentUntil)
      ) {
        followLatestRef.current = false;
        userScrollIntentUntil = 0;
      }
      previousScrollTop = nextScrollTop;
    };
    const observeWheel = (event: WheelEvent) => {
      if (restoreRef.current) restoreRef.current.pending = false;
      if (event.deltaY < 0) armUserScrollIntent();
    };
    const observeKeyboard = (event: KeyboardEvent) => {
      if (
        !keyboardRequestsTranscriptScroll(event)
        || editableKeyboardTarget(event.target)
        || (event.target instanceof HTMLElement
          && event.target !== ownerDocument.body
          && !scroller.contains(event.target))
      ) return;
      if (restoreRef.current) restoreRef.current.pending = false;
      if (keyboardRequestsOlderContent(event)) armUserScrollIntent();
    };
    const observePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.target !== scroller) return;
      pointerScrollActive = true;
      armUserScrollIntent();
    };
    const observePointerEnd = () => {
      if (pointerScrollActive) armUserScrollIntent();
      pointerScrollActive = false;
    };
    scroller.addEventListener("scroll", observeScrollDirection, { passive: true });
    scroller.addEventListener("wheel", observeWheel, { passive: true });
    scroller.addEventListener("pointerdown", observePointerDown, { passive: true });
    ownerDocument.addEventListener("keydown", observeKeyboard, true);
    ownerDocument.addEventListener("pointerup", observePointerEnd, true);
    ownerDocument.addEventListener("pointercancel", observePointerEnd, true);
    scrollerCleanupRef.current = () => {
      scroller.removeEventListener("scroll", observeScrollDirection);
      scroller.removeEventListener("wheel", observeWheel);
      scroller.removeEventListener("pointerdown", observePointerDown);
      ownerDocument.removeEventListener("keydown", observeKeyboard, true);
      ownerDocument.removeEventListener("pointerup", observePointerEnd, true);
      ownerDocument.removeEventListener("pointercancel", observePointerEnd, true);
    };
  }, []);

  const stopFollowingLatest = useCallback(() => {
    if (restoreRef.current) restoreRef.current.pending = false;
    followLatestRef.current = false;
    setAtBottom(false);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, false);
  }, [readKey]);

  const returnToLatest = useCallback(() => {
    if (restoreRef.current) restoreRef.current.pending = false;
    followLatestRef.current = true;
    setAtBottom(true);
    setUnseenRowCount(0);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, true);
    requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" }));
  }, [readKey]);

  const handleTotalListHeightChanged = useCallback(() => {
    if (restoreMeasuredAnchor()) return;
    if (!followLatestRef.current || historical || followScrollFrameRef.current) return;
    followScrollFrameRef.current = requestAnimationFrame(() => {
      followScrollFrameRef.current = 0;
      const scroller = scrollerRef.current;
      if (!followLatestRef.current || historical || !scroller) return;
      scroller.scrollTo({ top: scroller.scrollHeight });
    });
  }, [historical, restoreMeasuredAnchor]);

  const handleAtBottomStateChange = useCallback((nextAtBottom: boolean) => {
    if (historical || restoreRef.current?.pending) return;
    if (!nextAtBottom && followLatestRef.current) {
      // Virtuoso re-estimates unmeasured rows and Footer growth without always
      // reporting a total height change. Follow again on the next frame; a user
      // scroll up has cleared followLatestRef by then and keeps its position.
      handleTotalListHeightChanged();
      return;
    }
    if (nextAtBottom) followLatestRef.current = true;
    setAtBottom(nextAtBottom);
    if (nextAtBottom) setUnseenRowCount(0);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, nextAtBottom);
  }, [handleTotalListHeightChanged, historical, readKey]);

  const handleRangeChanged = useCallback((_range: ListRange) => {
    // Range notifications can outlive the scroller or precede its attachment.
    // Their overscan boundary is never evidence of the reader's position.
    const scroller = scrollerRef.current;
    if (restoreMeasuredAnchor()) return;
    if (scroller && !restoreRef.current?.pending) observeVisibleAnchor(scroller, { historical, readKey, rows });
  }, [historical, readKey, rows, restoreMeasuredAnchor]);

  useEffect(() => {
    const saved = readKey
      ? useConversationReadPositionStore.getState().positions[readKey]
      : undefined;
    const nextAtBottom = saved?.atBottom ?? true;
    followLatestRef.current = nextAtBottom;
    setAtBottom(nextAtBottom);
    setUnseenRowCount(saved?.unseenCount ?? 0);
    previousRowsRef.current = {
      readKey,
      count: rows.length,
      lastKey: rows.at(-1)?.key
    };
  }, [readKey]);

  useEffect(() => {
    if (historical) return;
    const previous = previousRowsRef.current;
    const lastKey = rows.at(-1)?.key;
    if (
      readKey
      && previous?.readKey === readKey
      && !atBottom
      && lastKey !== previous.lastKey
    ) {
      const added = Math.max(1, rows.length - previous.count);
      useConversationReadPositionStore.getState().addUnseen(readKey, added);
      setUnseenRowCount((current) => Math.min(999, current + added));
    }
    previousRowsRef.current = { readKey, count: rows.length, lastKey };
  }, [atBottom, historical, readKey, rows]);

  useEffect(() => () => {
    scrollerCleanupRef.current?.();
    cancelAnimationFrame(followScrollFrameRef.current);
    cancelAnimationFrame(anchorFrameRef.current);
    cancelAnimationFrame(restoreFrameRef.current);
  }, []);

  return {
    atBottom,
    bindScroller,
    handleAtBottomStateChange,
    handleRangeChanged,
    handleTotalListHeightChanged,
    restoredAnchorRowIndex,
    returnToLatest,
    stopFollowingLatest,
    unseenRowCount,
    virtuosoRef
  };
}

const USER_SCROLL_INTENT_WINDOW_MS = 750;
/** A row counts as the reading anchor once more than this much of it is visible. */
const VISIBLE_ANCHOR_MIN_PX = 8;

/**
 * Persist the first row actually visible in the scroller (Virtuoso's
 * `data-index` is the row position). Hidden scrollers (for example behind
 * Settings) report no geometry and must not overwrite the saved anchor.
 */
function observeVisibleAnchor(
  scroller: HTMLElement,
  { historical, readKey, rows }: { historical: boolean; readKey: string | undefined; rows: readonly TranscriptRow[] }
): boolean {
  if (historical || !readKey || scroller.clientHeight === 0) return false;
  const top = scroller.getBoundingClientRect().top;
  for (const node of scroller.querySelectorAll<HTMLElement>("[data-index]")) {
    if (node.getBoundingClientRect().bottom <= top + VISIBLE_ANCHOR_MIN_PX) continue;
    const row = rows[Number(node.dataset.index)];
    if (!row) return false;
    useConversationReadPositionStore.getState().observeAnchor(readKey, row.key);
    return true;
  }
  return false;
}

function keyboardRequestsOlderContent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.key === "ArrowUp"
    || event.key === "PageUp"
    || event.key === "Home"
    || (event.key === " " && event.shiftKey);
}

function keyboardRequestsTranscriptScroll(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  return keyboardRequestsOlderContent(event)
    || event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End" || event.key === " ";
}

function editableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}
