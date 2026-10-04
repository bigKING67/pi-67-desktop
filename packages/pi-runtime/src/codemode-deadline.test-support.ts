import { setTimeout as delay } from "node:timers/promises";
import { vi } from "vitest";
import { callNativeTool, type createNativeMcpFixture } from "./native-mcp.test-support.js";

// The native deadline includes Worker/WASM startup. Advance its clock only
// after the synthetic child confirms the preceding output crossed the Worker
// channel. The script keeps spinning after issuing that child call, so this
// also exercises Worker termination rather than only aborting an async wait.
// A separate real-clock test covers the unmodified startup/execution budget.
export async function runCodemodeWithOutputBeforeDeadline(
  fixture: Pick<Awaited<ReturnType<typeof createNativeMcpFixture>>, "session" | "records">,
  outputCode: string,
  maxOutputTokens = 1_000
): ReturnType<typeof callNativeTool> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = callNativeTool(fixture.session, "codemode", {
    code: `// @options: {"timeout_ms": 150, "max_output_tokens": ${maxOutputTokens}}\n${outputCode}\nvoid tools.mcp__synthetic__hold({}); while (true) {}`
  });
  // Observe rejection immediately even if readiness fails first.
  void pending.catch(() => undefined);
  try {
    const deadline = performance.now() + 10_000;
    while (!(await fixture.records()).some((record) => record.name === "hold")) {
      if (performance.now() >= deadline) throw new Error("Codemode output barrier did not reach the synthetic child.");
      await delay(10);
    }
    await vi.advanceTimersByTimeAsync(150);
    return await pending;
  } finally {
    vi.useRealTimers();
    await fixture.session.abort();
    await pending.catch(() => undefined);
  }
}
