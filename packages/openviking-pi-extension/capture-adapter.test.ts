import { describe, expect, it } from "vitest";
import { extractBranchCapturePayloads } from "./lib/capture-adapter.mjs";

const config = {
  faithfulCapture: true,
  captureAssistantTurns: true,
  captureToolResults: false,
  captureMaxLength: 24_000,
  peerId: "workspace-peer",
};

describe("OpenViking branch capture identity", () => {
  it("watermarks capturable messages rather than raw branch entries", () => {
    const branch = [
      custom("before"),
      message("u1", "user", "first task"),
      custom("between"),
      message("a1", "assistant", "first result"),
    ];
    const first = extractBranchCapturePayloads(branch, 0, config);
    expect(first.observedEntryCount).toBe(4);
    expect(first.observedCaptureCount).toBe(2);
    expect(first.payloads).toHaveLength(2);
    expect(first.payloads.map((payload: any) => payload.message_kind)).toEqual(["user_query", "assistant_step"]);
    expect(first.payloads.every((payload: any) => /^pi67:[a-f0-9]{64}$/u.test(payload.source_message_ids[0]))).toBe(true);

    const withAnotherCustomEntry = [...branch, custom("after")];
    const resumed = extractBranchCapturePayloads(withAnotherCustomEntry, 2, config, first.currentPrefixHash);
    expect(resumed.resetWatermark).toBe(false);
    expect(resumed.payloads).toEqual([]);
    expect(resumed.currentPrefixHash).toBe(first.currentPrefixHash);
  });

  it("detects same-length replacement, rewind, and stable append", () => {
    const original = [message("u1", "user", "task"), message("a1", "assistant", "old answer")];
    const initial = extractBranchCapturePayloads(original, 0, config);

    const replaced = extractBranchCapturePayloads(
      [message("u1", "user", "task"), message("a2", "assistant", "new answer")],
      2,
      config,
      initial.currentPrefixHash,
    );
    expect(replaced.resetWatermark).toBe(true);
    expect(replaced.payloads).toHaveLength(2);

    const rewound = extractBranchCapturePayloads([message("u1", "user", "task")], 2, config, initial.currentPrefixHash);
    expect(rewound.resetWatermark).toBe(true);

    const appended = extractBranchCapturePayloads(
      [...original, message("u2", "user", "next task")],
      2,
      config,
      initial.currentPrefixHash,
    );
    expect(appended.resetWatermark).toBe(false);
    expect(appended.payloads).toHaveLength(1);
    expect(appended.payloads[0].turn_id).toBe("pi-turn-2");
  });
});

function message(id: string, role: string, content: string) {
  return { type: "message", id, parentId: `${id}-parent`, message: { role, content } };
}

function custom(id: string) {
  return { type: "custom", customType: "fixture", data: { id } };
}
