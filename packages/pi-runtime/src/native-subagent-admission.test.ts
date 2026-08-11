import { describe, expect, it } from "vitest";
import { NativeSubagentAdmission } from "./native-subagent-admission.js";

describe("NativeSubagentAdmission", () => {
  it("enforces four children per parent without consuming another parent's capacity", () => {
    const admission = new NativeSubagentAdmission();
    for (let index = 0; index < 4; index += 1) {
      admission.acquire(lease("parent-a", `run-a-${index}`, `activation-a-${index}`));
    }
    expect(() => admission.acquire(lease("parent-a", "run-a-5", "activation-a-5")))
      .toThrow(/already has 4 live native subagents/u);
    expect(() => admission.acquire(lease("parent-b", "run-b-1", "activation-b-1"))).not.toThrow();
  });

  it("uses activation identity so an old release cannot free a resumed child", () => {
    const admission = new NativeSubagentAdmission();
    const previous = lease("parent", "run", "activation-1");
    const resumed = lease("parent", "run", "activation-2");
    admission.acquire(previous);
    admission.release(previous);
    admission.acquire(resumed);
    expect(admission.release(previous)).toBe(false);
    expect(admission.snapshot().global).toBe(1);
    expect(admission.release(resumed)).toBe(true);
  });

  it("enforces the independent global child limit and spawn batch bound", () => {
    const admission = new NativeSubagentAdmission();
    expect(() => admission.assertBatchSize(0)).toThrow(/1-4/u);
    expect(() => admission.assertBatchSize(5)).toThrow(/1-4/u);
    admission.assertBatchSize(4);
    for (let index = 0; index < 8; index += 1) {
      admission.acquire(lease(`parent-${Math.floor(index / 4)}`, `run-${index}`, `activation-${index}`));
    }
    expect(() => admission.acquire(lease("parent-3", "run-9", "activation-9")))
      .toThrow(/8 live native subagents/u);
  });
});

function lease(parentKey: string, runId: string, activationId: string) {
  return { parentKey, runId, activationId };
}
