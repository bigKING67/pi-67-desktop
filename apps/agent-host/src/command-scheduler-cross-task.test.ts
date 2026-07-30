import { describe, expect, it } from "vitest";
import { CommandScheduler } from "./command-scheduler.js";

describe("CommandScheduler cross-Task source locking", () => {
  it("acquires the source lock only when the source is immediately idle", async () => {
    let active = false;
    const scheduler = new CommandScheduler(() => active);
    await expect(scheduler.runExclusiveIfIdle(async () => "copied")).resolves.toBe("copied");

    let releaseControl!: () => void;
    const control = scheduler.run({
      type: "session.open",
      payload: { path: "/tmp/source.jsonl" }
    }, () => new Promise<void>((resolve) => { releaseControl = resolve; }));
    await Promise.resolve();
    await expect(scheduler.runExclusiveIfIdle(async () => "must-not-wait"))
      .rejects.toMatchObject({ code: "BUSY" });
    releaseControl();
    await control;

    active = true;
    await expect(scheduler.runExclusiveIfIdle(async () => "must-not-copy-active-turn"))
      .rejects.toMatchObject({ code: "BUSY" });
  });
});
