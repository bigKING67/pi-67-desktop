import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager, SettingsManager, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { expect } from "vitest";
import { createDesktopSessionServices } from "./session-services.js";
import { initializePrivateMemoryProvenance, assertPrivateMemoryProvenance } from "./session-memory-provenance.js";
import type { LocalMemoryAccess } from "./local-memory-extension-bridge.js";
import { requestPrivateMemoryCommit } from "./private-memory-commit.js";

/** Actual Pi loader, lifecycle and JSONL. Only the agent model output is synthetic;
 * Desktop supplies the real managed native connection through its existing port. */
export async function createPrivateMemoryNativeSession(input: {
  directory: string; agentDir: string; memory: LocalMemoryAccess; modelEndpoint: string; sessionFile?: string;
}) {
  const manager = input.sessionFile ? SessionManager.open(input.sessionFile)
    : SessionManager.create(input.directory, join(input.directory, "sessions"));
  initializePrivateMemoryProvenance(manager);
  assertPrivateMemoryProvenance(manager);
  const extensionRoot = fileURLToPath(new URL("../../openviking-pi-extension/", import.meta.url));
  const services = await createDesktopSessionServices({ cwd: input.directory, agentDir: input.agentDir,
    localMemory: input.memory, runtimeApiKeys: new Map([["openai", "synthetic-only"]]),
    settingsManager: SettingsManager.inMemory({ packages: [extensionRoot],
      compaction: { enabled: false }, retry: { enabled: false } }),
    getSafety: () => ({ cwd: input.directory, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
    requestApproval: async () => ({ status: "denied" }) });
  const loaded = services.resourceLoader.getExtensions();
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions.filter(entry => entry.resolvedPath === join(extensionRoot, "index.ts"))).toHaveLength(1);
  const model = { id: "synthetic", name: "Synthetic private memory model", provider: "openai",
    api: "openai-responses" as const, baseUrl: input.modelEndpoint,
    reasoning: false, input: ["text" as const], contextWindow: 100_000, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model });
  let calls = 0;
  let modelContext = "";
  session.agent.streamFunction = (_model, context) => {
    calls++;
    modelContext = JSON.stringify(context.messages);
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: `Synthetic private response ${calls}.` }], timestamp: Date.now(), stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message }); return stream;
  };
  try { await session.bindExtensions({ mode: "rpc" }); }
  catch (error) { session.dispose(); throw error; }
  return {
    async run(prompt: string) {
      const before = calls;
      await session.prompt(prompt);
      expect(session.agent.state.errorMessage).toBeUndefined(); expect(calls).toBe(before + 1);
      assertPrivateMemoryProvenance(manager);
      const file = manager.getSessionFile(); expect(file).toBeTruthy();
      const reopened = SessionManager.open(file!);
      assertPrivateMemoryProvenance(reopened);
      const states = reopened.getEntries().filter(entry => entry.type === "custom" && entry.customType === "ov-sync-state-v2");
      const last = states.at(-1);
      expect(last?.type).toBe("custom");
      const data = last?.type === "custom" ? last.data as { ovSessionId: string; syncedCaptureCount: number } : undefined;
      expect(data?.syncedCaptureCount).toBeGreaterThanOrEqual(2);
      return { sessionFile: file!, piSessionId: manager.getSessionId(), ovSessionId: data!.ovSessionId,
        syncedCaptureCount: data!.syncedCaptureCount, modelContext };
    },
    commit: () => requestPrivateMemoryCommit(services, manager.getSessionId(), () => !session.isStreaming),
    async close() { await session.abort(); session.dispose(); }
  };
}
