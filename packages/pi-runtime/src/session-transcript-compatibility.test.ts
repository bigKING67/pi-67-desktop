import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { createDesktopSessionServices } from "./session-services.js";
import { projectMessagePage } from "./message-projection.js";

it("persists and resumes Pi prompt/tool state without exposing control messages as conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-transcript-sdk-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const services = await createDesktopSessionServices({ cwd: root, agentDir, settingsManager,
    runtimeApiKeys: new Map([["openai", "synthetic-only"]]),
    getSafety: () => ({ cwd: root, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
    requestApproval: async () => ({ status: "denied" }) });
  const model = { id: "synthetic", name: "Synthetic", provider: "openai", api: "openai-responses" as const,
    baseUrl: "https://synthetic.invalid", reasoning: false, input: ["text" as const], contextWindow: 100_000,
    maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const manager = SessionManager.create(root, join(root, "sessions"));
  const first = await createAgentSessionFromServices({ services, sessionManager: manager, model });
  let calls = 0;
  const requests: { prompt: string; tools: string[] }[] = [];
  const stream: typeof first.session.agent.streamFunction = (_model, context) => {
    calls++;
    requests.push({ prompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages).map(tool => tool.name) });
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: `Synthetic response ${calls}` }], timestamp: Date.now(), stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } } };
    const output = createAssistantMessageEventStream();
    output.push({ type: "done", reason: "stop", message });
    return output;
  };
  try {
    first.session.agent.streamFunction = stream;
    await first.session.bindExtensions({ mode: "rpc" });
    await first.session.prompt("First synthetic turn");
    expect(first.session.agent.state.errorMessage).toBeUndefined();
    expect(requests[0]?.prompt).toContain("desktop_environment");
    expect(requests[0]?.tools.length).toBeGreaterThan(0);
    const file = manager.getSessionFile();
    expect(file).toBeTruthy();
    const reopened = SessionManager.open(file!);
    expect(reopened.getEntries().some(entry => entry.type === "message" && entry.message.role === "system")).toBe(true);
    expect(projectMessagePage(reopened).messages.map(message => message.role)).toEqual(["user", "assistant"]);
    const resumed = await createAgentSessionFromServices({ services, sessionManager: reopened, model });
    try {
      resumed.session.agent.streamFunction = stream;
      await resumed.session.bindExtensions({ mode: "rpc" });
      await resumed.session.prompt("Resumed synthetic turn");
      expect(resumed.session.agent.state.errorMessage).toBeUndefined();
      expect(calls).toBe(2);
      expect(requests[1]?.prompt).toBe(requests[0]?.prompt);
      expect(requests[1]?.tools).toEqual(requests[0]?.tools);
      const restored = SessionManager.open(file!);
      expect(projectMessagePage(restored).messages.map(message => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
      // Branch at the completed turn: before_agent_start updates follow the user entry.
      const completedTurn = restored.getEntries().find(entry => entry.type === "message" && entry.message.role === "assistant");
      expect(completedTurn).toBeDefined();
      restored.branch(completedTurn!.id);
      const branchContext = restored.buildSessionContext().messages;
      // Pi persists structured sections; legacy systemPrompt returns are run-local
      // projections. Desktop extensions reapply them on resume, verified above.
      expect(getCurrentSystemPrompt(branchContext)).toContain(root);
      expect(getCurrentSystemPrompt(branchContext)).not.toContain("desktop_environment");
      expect(getCurrentTools(branchContext).map(tool => tool.name)).toEqual(requests[0]?.tools);
    } finally { resumed.session.dispose(); }
  } finally {
    first.session.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
