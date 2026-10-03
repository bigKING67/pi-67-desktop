import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { RuntimePromptAttachments } from "./runtime-prompt-attachments.js";

it("cancels a real SDK run after idle preflight and accepts the next prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-preflight-cancel-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const preflight = Promise.withResolvers<void>();
  let enteredPreflight = false;
  const services = await createAgentSessionServices({
    cwd: root,
    agentDir,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off"
    }),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
      extensionFactories: [(pi) => {
        pi.on("before_agent_start", async () => {
          enteredPreflight = true;
          await preflight.promise;
        });
      }]
    }
  });
  await services.modelRuntime.setRuntimeApiKey("openai", "synthetic-only");
  const model = {
    id: "synthetic", name: "Synthetic", provider: "openai", api: "openai-responses" as const,
    baseUrl: "https://synthetic.invalid", reasoning: false, input: ["text" as const],
    contextWindow: 100_000, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  const { session } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.inMemory(root), model
  });
  const requestSignals: boolean[] = [];
  session.agent.streamFunction = (_model, _context, options) => {
    requestSignals.push(options?.signal?.aborted === true);
    options?.signal?.throwIfAborted();
    const message: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: "Recovered synthetic response" }],
      timestamp: Date.now(), stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { ...model.cost, total: 0 } }
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  };
  try {
    await session.bindExtensions({ mode: "rpc" });
    const attachments = new RuntimePromptAttachments(undefined);
    const controller = new AbortController();
    const first = attachments.submit(session, "Cancel during preflight", undefined, controller.signal);
    await vi.waitFor(() => expect(enteredPreflight).toBe(true));
    expect(session.isStreaming).toBe(false);
    controller.abort();
    await session.abort(); // Host cancellation arrives before Agent.activeRun exists.
    preflight.resolve();
    await first;

    expect(requestSignals.every((aborted) => aborted)).toBe(true);
    expect(session.isStreaming).toBe(false);
    expect(session.agent.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "aborted" });
    requestSignals.length = 0;

    await attachments.submit(session, "Recover after cancellation", undefined, new AbortController().signal);
    expect(requestSignals).toEqual([false]);
    expect(session.agent.state.errorMessage).toBeUndefined();
    expect(session.agent.state.messages.at(-1)).toMatchObject({
      role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Recovered synthetic response" }]
    });
  } finally {
    preflight.resolve();
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
