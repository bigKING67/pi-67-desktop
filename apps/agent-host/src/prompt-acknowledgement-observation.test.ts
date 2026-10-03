import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

it("is silent outside the explicit test capture mode and preserves dispatch", async () => {
  const { observePromptAcknowledgementRequest, observePromptAcknowledgement } = await import("./prompt-acknowledgement-observation.js");
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const dispatch = vi.fn(() => observePromptAcknowledgement("runtime-ready"));
  vi.stubEnv("PI67_TEST_CAPTURE_AGENT_INIT", "1");
  vi.stubEnv("NODE_ENV", "production");
  observePromptAcknowledgementRequest("prompt.submit", dispatch);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PI67_TEST_CAPTURE_AGENT_INIT", "0");
  observePromptAcknowledgementRequest("prompt.submit", dispatch);
  vi.stubEnv("PI67_TEST_CAPTURE_AGENT_INIT", "1");
  observePromptAcknowledgementRequest("model.list", dispatch);
  expect(dispatch).toHaveBeenCalledTimes(3);
  expect(stderr).not.toHaveBeenCalled();
});

it("isolates concurrent admissions, stops at ACK and bounds the capture", async () => {
  const { observePromptAcknowledgementRequest, observePromptAcknowledgement } = await import("./prompt-acknowledgement-observation.js");
  vi.stubEnv("PI67_TEST_CAPTURE_AGENT_INIT", "1");
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  let resume!: () => void;
  const held = new Promise<void>((resolve) => { resume = resolve; });
  let first!: Promise<void>;
  observePromptAcknowledgementRequest("prompt.submit", () => {
    first = held.then(() => {
      observePromptAcknowledgement("response-posted");
      observePromptAcknowledgement("runtime-ready");
    });
  });
  observePromptAcknowledgementRequest("prompt.submit", () => observePromptAcknowledgement("response-failed"));
  resume();
  await first;
  const records = stderr.mock.calls.map(([line]) => JSON.parse(String(line).slice("[agent-host:prompt-ack] ".length)));
  expect(records.map(({ attempt, stage }) => [attempt, stage])).toEqual([
    [1, "received"], [2, "received"], [2, "response-failed"], [1, "response-posted"]
  ]);
  const dispatch = vi.fn(() => {
    for (let index = 0; index < 50; index += 1) observePromptAcknowledgement("runtime-ready");
  });
  for (let index = 0; index < 100; index += 1) observePromptAcknowledgementRequest("prompt.submit", dispatch);
  expect(dispatch).toHaveBeenCalledTimes(100);
  expect(stderr.mock.calls.length).toBe(4 + 62 * 16);
});

it("never replaces a dispatch result with a diagnostic stream failure", async () => {
  const { observePromptAcknowledgementRequest } = await import("./prompt-acknowledgement-observation.js");
  vi.stubEnv("PI67_TEST_CAPTURE_AGENT_INIT", "1");
  vi.spyOn(process.stderr, "write").mockImplementation(() => { throw new Error("closed stderr"); });
  const dispatch = vi.fn();
  expect(() => observePromptAcknowledgementRequest("prompt.submit", dispatch)).not.toThrow();
  expect(dispatch).toHaveBeenCalledOnce();
});
