import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestComposerPrefill,
  subscribeToComposerPrefill
} from "./composer-events.js";

describe("composer prefill events", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("delivers only typed text events and stops after unsubscribe", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const received: string[] = [];
    const unsubscribe = subscribeToComposerPrefill((text) => received.push(text));

    target.dispatchEvent(new Event("pi67:composer-prefill"));
    target.dispatchEvent(new CustomEvent("pi67:composer-prefill", { detail: 67 }));
    requestComposerPrefill("检查当前改动");
    requestComposerPrefill("修改历史问题");

    expect(received).toEqual(["检查当前改动", "修改历史问题"]);
    unsubscribe();
    requestComposerPrefill("不应继续投递");
    expect(received).toHaveLength(2);
  });
});
