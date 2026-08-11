import { describe, expect, it } from "vitest";
import {
  MAX_NATIVE_SUBAGENT_LIVE_GLOBAL,
  MAX_NATIVE_SUBAGENT_LIVE_PER_PARENT,
  MAX_NATIVE_SUBAGENT_NESTING_DEPTH,
  MAX_NATIVE_SUBAGENT_SPAWN_BATCH,
  isNativeSubagentTerminalState
} from "./native-subagent.js";

describe("native subagent contract", () => {
  it("keeps child admission independent from the top-level Task contract", () => {
    expect(MAX_NATIVE_SUBAGENT_LIVE_GLOBAL).toBe(8);
    expect(MAX_NATIVE_SUBAGENT_LIVE_PER_PARENT).toBe(4);
    expect(MAX_NATIVE_SUBAGENT_SPAWN_BATCH).toBe(4);
    expect(MAX_NATIVE_SUBAGENT_NESTING_DEPTH).toBe(2);
  });

  it("treats only durable terminal outcomes as terminal", () => {
    expect(isNativeSubagentTerminalState("pending")).toBe(false);
    expect(isNativeSubagentTerminalState("running")).toBe(false);
    expect(isNativeSubagentTerminalState("waiting")).toBe(false);
    expect(isNativeSubagentTerminalState("idle")).toBe(false);
    expect(isNativeSubagentTerminalState("completed")).toBe(true);
    expect(isNativeSubagentTerminalState("failed")).toBe(true);
    expect(isNativeSubagentTerminalState("cancelled")).toBe(true);
    expect(isNativeSubagentTerminalState("interrupted")).toBe(true);
  });
});
