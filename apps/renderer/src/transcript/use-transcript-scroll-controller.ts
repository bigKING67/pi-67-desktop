import { useCallback, useEffect, useRef, useState } from "react";
import type { ListRange, VirtuosoHandle } from "react-virtuoso";
import { useConversationReadPositionStore } from "./conversation-read-position-store.js";
import type { TranscriptRow } from "./transcript-rows.js";

interface TranscriptScrollControllerOptions {
  firstItemIndex: number;
  historical: boolean;
  readKey: string | undefined;
  rows: readonly TranscriptRow[];
}

export function useTranscriptScrollController({
  firstItemIndex,
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
  const previousRowsRef = useRef<{
    readKey: string | undefined;
    count: number;
    lastKey: string | undefined;
  } | undefined>(undefined);
  const savedReadPosition = readKey
    ? useConversationReadPositionStore.getState().positions[readKey]
    : undefined;
  const restoredAnchorRowIndex = !historical && savedReadPosition && !savedReadPosition.atBottom
    ? rows.findIndex((row) => row.key === savedReadPosition.anchorKey)
    : -1;

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
      userScrollIntentUntil = performance.now() + USER_SCROLL_INTENT_WINDOW_MS;
    };
    const observeScrollDirection = () => {
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
      if (event.deltaY < 0) armUserScrollIntent();
    };
    const observeKeyboard = (event: KeyboardEvent) => {
      if (
        !keyboardRequestsOlderContent(event)
        || editableKeyboardTarget(event.target)
        || (event.target instanceof HTMLElement
          && event.target !== ownerDocument.body
          && !scroller.contains(event.target))
      ) return;
      armUserScrollIntent();
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
    followLatestRef.current = false;
    setAtBottom(false);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, false);
  }, [readKey]);

  const returnToLatest = useCallback(() => {
    followLatestRef.current = true;
    setAtBottom(true);
    setUnseenRowCount(0);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, true);
    requestAnimationFrame(() => virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end" }));
  }, [readKey]);

  const handleTotalListHeightChanged = useCallback(() => {
    if (!followLatestRef.current || historical || followScrollFrameRef.current) return;
    followScrollFrameRef.current = requestAnimationFrame(() => {
      followScrollFrameRef.current = 0;
      const scroller = scrollerRef.current;
      if (!followLatestRef.current || historical || !scroller) return;
      scroller.scrollTo({ top: scroller.scrollHeight });
    });
  }, [historical]);

  const handleAtBottomStateChange = useCallback((nextAtBottom: boolean) => {
    if (historical) return;
    if (!nextAtBottom && followLatestRef.current) return;
    if (nextAtBottom) followLatestRef.current = true;
    setAtBottom(nextAtBottom);
    if (nextAtBottom) setUnseenRowCount(0);
    if (readKey) useConversationReadPositionStore.getState().setAtBottom(readKey, nextAtBottom);
  }, [historical, readKey]);

  const handleRangeChanged = useCallback((range: ListRange) => {
    if (!readKey || historical) return;
    const row = rows[range.startIndex - firstItemIndex];
    if (row) useConversationReadPositionStore.getState().observeAnchor(readKey, row.key);
  }, [firstItemIndex, historical, readKey, rows]);

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

function keyboardRequestsOlderContent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.key === "ArrowUp"
    || event.key === "PageUp"
    || event.key === "Home"
    || (event.key === " " && event.shiftKey);
}

function editableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}
