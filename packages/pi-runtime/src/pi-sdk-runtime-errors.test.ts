import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

describe("PiSdkRuntime errors", () => {
  it("throws structured errors for runtime lifecycle and selection failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-errors-"));
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    const runtime = new PiSdkRuntime();

    expect(captureError(() => runtime.getSnapshot())).toMatchObject({
      code: "RUNTIME_NOT_READY",
      recoverable: true
    });

    try {
      const initializing = runtime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" });
      await expect(runtime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" }))
        .rejects.toMatchObject({ code: "BUSY", details: { retryable: true } });
      await initializing;

      await expect(runtime.selectModel("missing-provider", "missing-model"))
        .rejects.toMatchObject({ code: "MODEL_NOT_FOUND", recoverable: true });
      await expect(runtime.setThinkingLevel("unsupported-level"))
        .rejects.toMatchObject({ code: "UNSUPPORTED", details: { feature: "thinking-level" } });
    } finally {
      await runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});

function captureError(operation: () => unknown): unknown {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error;
  }
}
