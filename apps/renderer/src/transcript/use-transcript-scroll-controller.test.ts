import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FlatScrollIntoViewLocation, VirtuosoHandle } from "react-virtuoso";
import { useConversationReadPositionStore } from "./conversation-read-position-store.js";
import type { TranscriptRow } from "./transcript-rows.js";
import { useTranscriptScrollController } from "./use-transcript-scroll-controller.js";

beforeEach(() => useConversationReadPositionStore.getState().reset());
afterEach(() => vi.unstubAllGlobals());

it("keeps the saved row through estimated layout until measured scrolling completes", () => {
  const store = useConversationReadPositionStore.getState();
  store.observeAnchor("conversation", "message-65");
  store.setAtBottom("conversation", false);
  const rows: TranscriptRow[] = Array.from({ length: 72 }, (_, index) => ({
    kind: "message", key: `message-${index}`,
    message: { id: `message-${index}`, role: "assistant", parts: [] }
  }));
  let visibleIndex = 63;
  class Scroller {
    scrollTop = 7_800;
    clientHeight = 500;
    ownerDocument = { addEventListener() {}, removeEventListener() {} };
    addEventListener() {}
    removeEventListener() {}
    getBoundingClientRect() { return { top: 0 }; }
    querySelectorAll() { return [{ dataset: { index: String(visibleIndex) }, getBoundingClientRect: () => ({ bottom: 229 }) }]; }
  }
  vi.stubGlobal("HTMLElement", Scroller);
  let frame!: FrameRequestCallback;
  const scheduleFrame = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("requestAnimationFrame", scheduleFrame);
  let controller!: ReturnType<typeof useTranscriptScrollController>;
  function Probe() {
    controller = useTranscriptScrollController({ historical: false, readKey: "conversation", rows });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  const range = { startIndex: 61, endIndex: 66 };
  controller.handleRangeChanged(range);
  expect(scheduleFrame).not.toHaveBeenCalled();
  controller.bindScroller(new Scroller() as unknown as HTMLElement);
  let location!: FlatScrollIntoViewLocation;
  const scrollIntoView = vi.fn((value: FlatScrollIntoViewLocation) => { location = value; });
  controller.virtuosoRef.current = { scrollIntoView } as unknown as VirtuosoHandle;
  controller.handleRangeChanged(range);
  controller.handleAtBottomStateChange(true);
  frame(0);
  controller.handleRangeChanged(range);
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(location).toMatchObject({ index: 65, align: "start", behavior: "auto" });
  expect(useConversationReadPositionStore.getState().positions.conversation).toMatchObject({ anchorKey: "message-65", atBottom: false });
  visibleIndex = 65;
  location.done?.();
  visibleIndex = 64;
  controller.handleRangeChanged(range);
  expect(useConversationReadPositionStore.getState().positions.conversation?.anchorKey).toBe("message-64");
});

it("keeps the measured reading anchor when a range arrives without a scroller", () => {
  const store = useConversationReadPositionStore.getState();
  store.observeAnchor("conversation", "message-65");
  store.setAtBottom("conversation", false);
  const rows: TranscriptRow[] = Array.from({ length: 72 }, (_, index) => ({
    kind: "message", key: `message-${index}`,
    message: { id: `message-${index}`, role: "assistant", parts: [{ type: "text", text: "Reading context" }] }
  }));
  let controller: ReturnType<typeof useTranscriptScrollController> | undefined;
  function Probe() {
    controller = useTranscriptScrollController({ historical: false, readKey: "conversation", rows });
    return null;
  }
  // Server rendering creates the real hook state without attaching a DOM
  // scroller, reproducing an early/late virtualizer range notification.
  renderToStaticMarkup(createElement(Probe));
  if (!controller) throw new Error("Expected the scroll controller.");
  controller.handleRangeChanged({ startIndex: 63, endIndex: 71 });
  expect(useConversationReadPositionStore.getState().positions.conversation?.anchorKey).toBe("message-65");
});

it.each(["ArrowUp", "PageUp", "Home", "ArrowDown", "PageDown", "End", " "])(
  "lets %j cancel restoration before its scheduled frame", (key) => {
    const store = useConversationReadPositionStore.getState();
    store.observeAnchor("conversation", "message-65");
    store.setAtBottom("conversation", false);
    let keydown!: (event: KeyboardEvent) => void;
    class Scroller {
      scrollTop = 7_800;
      clientHeight = 500;
      ownerDocument = {
        body: {},
        addEventListener(type: string, listener: (event: KeyboardEvent) => void) {
          if (type === "keydown") keydown = listener;
        },
        removeEventListener() {}
      };
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal("HTMLElement", Scroller);
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    let controller!: ReturnType<typeof useTranscriptScrollController>;
    function Probe() {
      controller = useTranscriptScrollController({
        historical: false, readKey: "conversation", rows: [{
          kind: "message", key: "message-65",
          message: { id: "message-65", role: "assistant", parts: [] }
        }]
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const scroller = new Scroller();
    controller.bindScroller(scroller as unknown as HTMLElement);
    const scrollIntoView = vi.fn();
    controller.virtuosoRef.current = { scrollIntoView } as unknown as VirtuosoHandle;
    controller.handleRangeChanged({ startIndex: 0, endIndex: 0 });
    keydown({ key, target: scroller.ownerDocument.body } as unknown as KeyboardEvent);
    frame(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  }
);
