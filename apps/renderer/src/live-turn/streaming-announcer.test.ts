import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StreamingAnnouncerScheduler,
  takeStreamingAnnouncementChunk,
  type StreamingAnnouncementAuthority
} from "./streaming-announcer.js";

const AUTHORITY: StreamingAnnouncementAuthority = {
  hostEpoch: 7,
  sessionId: "session-a",
  sessionGeneration: 3,
  operationId: "operation-a"
};

describe("streaming announcer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces only new assistant text at most once per second", () => {
    const announce = vi.fn();
    const scheduler = new StreamingAnnouncerScheduler({ announce });

    scheduler.update("Hello", AUTHORITY);
    expect(announce.mock.calls).toEqual([[""], ["Hello"]]);

    scheduler.update("Hello world", AUTHORITY);
    vi.advanceTimersByTime(999);
    expect(announce).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(announce).toHaveBeenLastCalledWith("world");

    scheduler.update("Hello world. More", AUTHORITY);
    vi.advanceTimersByTime(1_000);
    expect(announce).toHaveBeenLastCalledWith(".");
    vi.advanceTimersByTime(1_000);
    expect(announce).toHaveBeenLastCalledWith("More");
  });

  it("clears pending speech when authority changes or the live turn settles", () => {
    const announce = vi.fn();
    const scheduler = new StreamingAnnouncerScheduler({ announce });

    scheduler.update("First", AUTHORITY);
    scheduler.update("First stale suffix", AUTHORITY);
    scheduler.update("Second", { ...AUTHORITY, operationId: "operation-b" });
    expect(announce.mock.calls.slice(-2)).toEqual([[""], ["Second"]]);

    scheduler.update("Second pending", { ...AUTHORITY, operationId: "operation-b" });
    scheduler.reset();
    vi.advanceTimersByTime(2_000);
    expect(announce).toHaveBeenLastCalledWith("");
  });

  it("prefers sentence boundaries and counts Unicode characters", () => {
    expect(takeStreamingAnnouncementChunk("Alpha. Beta gamma", 10)).toEqual({
      announcement: "Alpha.",
      remainder: " Beta gamma"
    });
    expect(takeStreamingAnnouncementChunk("你🙂好", 2)).toEqual({
      announcement: "你🙂",
      remainder: "好"
    });
  });
});
