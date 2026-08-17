import { describe, expect, it } from "vitest";
import { isSkillPackProcessWorkerOutput } from "./skill-pack-process-worker-protocol.js";

describe("isSkillPackProcessWorkerOutput", () => {
  it("accepts a bounded output chunk for the active request", () => {
    expect(isSkillPackProcessWorkerOutput({
      type: "skill-pack-process-output",
      requestId: "request-1",
      stream: "stderr",
      chunkBase64: Buffer.from("https://open.feishu.cn/setup", "utf8").toString("base64")
    }, "request-1")).toBe(true);
  });

  it("rejects output for another request or malformed and oversized chunks", () => {
    const output = {
      type: "skill-pack-process-output",
      requestId: "request-1",
      stream: "stdout",
      chunkBase64: "c2V0dXA="
    };
    expect(isSkillPackProcessWorkerOutput(output, "request-2")).toBe(false);
    expect(isSkillPackProcessWorkerOutput({ ...output, chunkBase64: "not base64" }, "request-1")).toBe(false);
    expect(isSkillPackProcessWorkerOutput({
      ...output,
      chunkBase64: "A".repeat((96 * 1024) + 1)
    }, "request-1")).toBe(false);
  });
});
