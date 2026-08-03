import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createDesktopEnvironmentBlock,
  createDesktopEnvironmentExtension
} from "./desktop-environment-extension.js";

type BeforeAgentStartHandler = (event: { systemPrompt: string }) => {
  systemPrompt?: string;
} | undefined;

describe("desktop environment extension", () => {
  it("formats the device calendar date and IANA offset without a moving clock value", () => {
    const block = createDesktopEnvironmentBlock(
      new Date("2026-08-03T16:30:45.000Z"),
      "Asia/Shanghai"
    );

    expect(block).toContain("Current local date: 2026-08-04");
    expect(block).toContain("Current local timezone: Asia/Shanghai (UTC+08:00)");
    expect(block).not.toContain("16:30");
    expect(block).not.toContain("45.000");
  });

  it("stays stable within one local day and changes after local midnight", () => {
    const before = createDesktopEnvironmentBlock(
      new Date("2026-08-03T02:00:00.000Z"),
      "Asia/Shanghai"
    );
    const later = createDesktopEnvironmentBlock(
      new Date("2026-08-03T14:00:00.000Z"),
      "Asia/Shanghai"
    );
    const nextDay = createDesktopEnvironmentBlock(
      new Date("2026-08-03T16:01:00.000Z"),
      "Asia/Shanghai"
    );

    expect(later).toBe(before);
    expect(nextDay).not.toBe(before);
    expect(nextDay).toContain("Current local date: 2026-08-04");
  });

  it("falls back to the process-local calendar and offset for invalid IANA data", () => {
    const date = new Date("2026-08-03T08:00:00.000Z");
    const block = createDesktopEnvironmentBlock(date, "Invalid/Desktop-Zone");
    const expectedDate = [
      date.getFullYear().toString().padStart(4, "0"),
      (date.getMonth() + 1).toString().padStart(2, "0"),
      date.getDate().toString().padStart(2, "0")
    ].join("-");

    expect(block).toContain(`Current local date: ${expectedDate}`);
    expect(block).toMatch(/Current local timezone: UTC[+-]\d{2}:\d{2}/u);
    expect(block).not.toContain("Invalid/Desktop-Zone");
  });

  it("appends the bounded context without replacing the effective Pi prompt", () => {
    const handler = beforeAgentStartHandler({
      now: () => new Date("2026-08-03T08:00:00.000Z"),
      resolveTimeZone: () => "Asia/Shanghai"
    });
    const result = handler({ systemPrompt: "base prompt\nproject context" });

    expect(result?.systemPrompt).toMatch(/^base prompt\nproject context\n\n<desktop_environment>/u);
    expect(result?.systemPrompt).toContain("Current local date: 2026-08-03");
    expect(result?.systemPrompt).toContain("verify them with available tools");
  });

  it("recovers when the host time-zone resolver is unavailable", () => {
    const handler = beforeAgentStartHandler({
      now: () => new Date("2026-08-03T08:00:00.000Z"),
      resolveTimeZone: () => { throw new Error("timezone unavailable"); }
    });

    expect(handler({ systemPrompt: "base" })?.systemPrompt)
      .toMatch(/Current local timezone: UTC[+-]\d{2}:\d{2}/u);
  });
});

function beforeAgentStartHandler(
  options: Parameters<typeof createDesktopEnvironmentExtension>[0]
): BeforeAgentStartHandler {
  let handler: BeforeAgentStartHandler | undefined;
  const extension = createDesktopEnvironmentExtension(options);
  if (!("factory" in extension)) throw new Error("Expected Desktop environment factory.");
  void extension.factory({
    on(event: string, candidate: unknown) {
      if (event === "before_agent_start") handler = candidate as BeforeAgentStartHandler;
    }
  } as unknown as ExtensionAPI);
  if (!handler) throw new Error("Expected before_agent_start handler.");
  return handler;
}
