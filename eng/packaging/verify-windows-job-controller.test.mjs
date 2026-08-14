import { describe, expect, it } from "vitest";
import {
  parseWindowsJobControllerSmokeMessage,
  verifyWindowsJobController
} from "./verify-windows-job-controller.mjs";

describe("Windows Package Worker Job controller smoke", () => {
  it("skips native process verification outside Windows", async () => {
    await expect(verifyWindowsJobController("darwin", "arm64")).resolves.toEqual({ status: "not-required" });
  });

  it("accepts only bounded controller status messages", () => {
    expect(parseWindowsJobControllerSmokeMessage('{"type":"status","activeProcesses":2}')).toEqual({
      type: "status",
      activeProcesses: 2
    });
    expect(parseWindowsJobControllerSmokeMessage('{"type":"status","activeProcesses":-1}')).toBeUndefined();
    expect(parseWindowsJobControllerSmokeMessage('{"type":"unknown","activeProcesses":0}')).toBeUndefined();
    expect(() => parseWindowsJobControllerSmokeMessage(
      '{"type":"error","operation":"assign-process","code":5}'
    )).toThrow("assign-process (5)");
  });
});
