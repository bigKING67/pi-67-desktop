import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeWindowsUiShutdown, parseWindowsUiHostShutdown, parseWindowsUiShutdownObservations } from "./windows-ui-shutdown-observation.mjs";

afterEach(() => vi.restoreAllMocks());

describe("Windows UI shutdown observations", () => {
  it("uses the existing bounded Host parser without exposing raw fields", () => {
    const record = { sequence: 1, stage: "runtime-session", outcome: "completed", durationMs: 14 };
    const line = value => `[agent-host:shutdown] ${JSON.stringify(value)}\n`;
    expect(parseWindowsUiHostShutdown("private output\n" + line({ ...record, secret: "drop" })
      + line({ ...record, stage: "private-stage" }))).toEqual([record]);
    expect(parseWindowsUiHostShutdown(line(record).repeat(140))).toHaveLength(128);
  });

  it("classifies native child exits without collecting process names", async () => {
    const app = new EventEmitter();
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.spyOn(process, "once").mockReturnValue(process);
    await observeWindowsUiShutdown({ evaluate: (callback, options) => callback({
      app, BrowserWindow: { getAllWindows: () => [] }
    }, options) });
    app.emit("before-quit");
    for (const details of [
      { type: "Utility", serviceName: "Pi-67 Agent Host" },
      { type: "Utility", serviceName: "private-service" },
      { type: "GPU" }, { type: "unrelated" }
    ]) app.emit("child-process-gone", {}, details);
    const output = write.mock.calls.map(([line]) => line).join("");
    expect(parseWindowsUiShutdownObservations(output).map(record => record.stage))
      .toEqual(["before-quit", "agent-host-exit", "utility-exit", "gpu-exit"]);
    expect(output).not.toContain("private-service");
  });

  it("records ordered Main events without preventing or forcing shutdown", async () => {
    const app = new EventEmitter();
    const window = new EventEmitter();
    window.webContents = new EventEmitter();
    let time = 100;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    let onExit;
    vi.spyOn(process, "once").mockImplementation((event, callback) => {
      expect(event).toBe("exit"); onExit = callback; return process;
    });
    await observeWindowsUiShutdown({ evaluate: (callback, options) => callback({
      app, BrowserWindow: { getAllWindows: () => [window] }
    }, options) });
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(write).not.toHaveBeenCalled();
    app.emit("before-quit", event);
    time = 120;
    app.emit("before-quit", event);
    window.emit("close", event);
    window.webContents.emit("will-prevent-unload", event);
    window.webContents.emit("destroyed");
    window.emit("closed");
    app.emit("will-quit", event);
    time = 140;
    app.emit("quit", event);
    onExit();
    expect(event.preventDefault).not.toHaveBeenCalled();
    const records = parseWindowsUiShutdownObservations(write.mock.calls.map(([line]) => line).join(""));
    expect(records.map(record => record.stage)).toEqual([
      "before-quit", "before-quit", "window-close", "will-prevent-unload",
      "webcontents-destroyed", "window-closed", "will-quit", "quit", "process-exit"
    ]);
    expect(records.at(-1)).toEqual({ stage: "process-exit", sequence: 9, elapsedMs: 40 });
    for (let count = 0; count < 30; count += 1) app.emit("before-quit", event);
    expect(write).toHaveBeenCalledTimes(16);
  });

  it("does not let diagnostic write failure prevent app shutdown", async () => {
    const app = new EventEmitter();
    vi.spyOn(process, "once").mockReturnValue(process);
    vi.spyOn(process.stderr, "write").mockImplementation(() => { throw new Error("closed stream"); });
    await observeWindowsUiShutdown({ evaluate: (callback, options) => callback({
      app, BrowserWindow: { getAllWindows: () => [] }
    }, options) });
    expect(() => app.emit("before-quit")).not.toThrow();
    expect(() => app.emit("quit")).not.toThrow();
  });

  it("accepts only bounded fixed stages and drops raw fields and malformed records", () => {
    const line = value => `Windows UI shutdown stage: ${JSON.stringify(value)}\n`;
    const valid = { stage: "quit", sequence: 3, elapsedMs: 123 };
    const output = "unrelated output\nWindows UI shutdown stage: {partial\n" + [
      { ...valid, stage: "private-content" }, { ...valid, sequence: 17 },
      { ...valid, elapsedMs: -1 }, { ...valid, private: "must not escape" }
    ].map(line).join("");
    expect(parseWindowsUiShutdownObservations(output)).toEqual([valid]);
    expect(parseWindowsUiShutdownObservations(Array.from({ length: 30 }, () => line(valid)).join("")))
      .toHaveLength(16);
  });
});
