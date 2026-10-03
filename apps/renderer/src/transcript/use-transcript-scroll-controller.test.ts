import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it } from "vitest";
import { useConversationReadPositionStore } from "./conversation-read-position-store.js";
import type { TranscriptRow } from "./transcript-rows.js";
import { useTranscriptScrollController } from "./use-transcript-scroll-controller.js";

beforeEach(() => useConversationReadPositionStore.getState().reset());

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
