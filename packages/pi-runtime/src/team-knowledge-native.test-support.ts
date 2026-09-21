import type { JsonValue } from "@earendil-works/pi-ai";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { SessionManager, SettingsManager, createAgentSessionFromServices, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { TeamSessionIdentity } from "@pi67/domain";
import type { TeamKnowledgeAccess } from "./team-knowledge-access.js";
import { createSessionSharedKnowledgeTools } from "./session-shared-knowledge-tools.js";
import { markTeamSessionBirth } from "./team-session-birth.js";
import { authorizeTeamHistory, type TeamHistoryAccess } from "./team-history-authorization.js";
import { assertPrivateMemoryProvenance } from "./session-memory-provenance.js";
import { createDesktopSessionServices } from "./session-services.js";
import { bindSharedHistoryModelGuard } from "./shared-history-model-guard.js";
import type { TeamKnowledgeDocument } from "./team-knowledge-access.js";

/** Real Pi JSONL/Tool seam for the native index integration test. Keeps SDK
 * ownership here; the caller supplies ports, never imports Pi through Desktop. */
export function createNativeKnowledgeSession(input: {
  directory: string; identity: TeamSessionIdentity; model: { baseUrl: string; id: string };
  access: TeamKnowledgeAccess; signal: AbortSignal;
  authorizeTeamSession: NonNullable<TeamHistoryAccess["authorizeTeamSession"]>;
}) {
  let manager = SessionManager.inMemory(input.directory);
  markTeamSessionBirth(manager, input.identity);
  const birth = manager.getLeafId()!;
  const tools = createSessionSharedKnowledgeTools(undefined, undefined, () => manager, input.access);
  const call = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(name, args, input.signal, undefined,
    { sessionManager: manager, model: input.model } as unknown as ExtensionContext);
  return {
    call,
    async persistAndReopen(search: Awaited<ReturnType<typeof call>>, read: Awaited<ReturnType<typeof call>>) {
      for (const [name, result] of [["viking_team_search", search], ["viking_team_read", read]] as const) {
        manager.appendMessage({ role: "toolResult", toolCallId: name, toolName: name, isError: false, timestamp: 1, ...result, details: result.details as JsonValue });
      }
      const path = join(input.directory, "team-session.jsonl");
      await writeFile(path, [manager.getHeader(), ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n", { mode: 0o600 });
      manager = SessionManager.open(path); manager.branch(birth);
    },
    verifyHistory: () => authorizeTeamHistory(manager, input.model, {
      teamKnowledgeAccess: input.access, authorizeTeamSession: input.authorizeTeamSession
    }, input.signal),
    assertReadOnlyHistory() {
      expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
      expect(manager.getEntries().filter(entry => entry.type === "message")).toHaveLength(2);
    }
  };
}

/** Real SDK loop and JSONL writer. Only the provider stream is scripted; the SDK
 * chooses the execution lifecycle and routes actual registered canonical tools. */
export async function createKnowledgeAgentLoop(input: {
  directory: string; identity: TeamSessionIdentity; model: { baseUrl: string; id: string };
  access: TeamKnowledgeAccess; assetId: string; document: TeamKnowledgeDocument;
  authorizeTeamSession: NonNullable<TeamHistoryAccess["authorizeTeamSession"]>;
}) {
  const manager = SessionManager.create(input.directory, join(input.directory, "agent-loop-sessions"));
  markTeamSessionBirth(manager, input.identity);
  const services = await createDesktopSessionServices({ cwd: input.directory, agentDir: join(input.directory, "agent-loop-profile"),
    noThirdPartyExtensions: true, runtimeApiKeys: new Map([["openai", "synthetic-loop-only"]]),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    getSafety: () => ({ cwd: input.directory, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
    requestApproval: async () => ({ status: "allowed" }) });
  const model = { ...input.model, api: "openai-responses" as const, provider: "openai", name: "Synthetic loop model",
    reasoning: false, input: ["text" as const], contextWindow: 100_000, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager, model,
    customTools: createSessionSharedKnowledgeTools(undefined, undefined, () => manager, input.access) });
  let modelCalls = 0;
  session.agent.streamFunction = (_model, context) => {
    modelCalls++;
    expect(modelCalls).toBeLessThanOrEqual(3);
    const previous = context.messages.filter(message => message.role === "toolResult");
    if (modelCalls >= 2) expect(previous[0]).toMatchObject({ toolName: "viking_team_search", isError: false });
    if (modelCalls === 3) {
      expect(previous[1]).toMatchObject({ toolName: "viking_team_read", isError: false });
      expect(JSON.stringify(previous[1]!.content)).toContain(input.document.body);
    }
    const content: AssistantMessage["content"] = modelCalls === 1
      ? [{ type: "toolCall", name: "viking_team_search", id: "loop-search", arguments: { query: "shipping", scope: "team", limit: 1 } }]
      : modelCalls === 2 ? [{ type: "toolCall", name: "viking_team_read", id: "loop-read", arguments: { assetId: input.assetId } }]
        : [{ type: "text", text: "Synthetic knowledge loop complete." }];
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content, timestamp: Date.now(), stopReason: modelCalls < 3 ? "toolUse" : "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...model.cost, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: modelCalls < 3 ? "toolUse" : "stop", message }); return stream;
  };
  bindSharedHistoryModelGuard(session, { teamKnowledgeAccess: input.access, authorizeTeamSession: input.authorizeTeamSession });
  try { await session.bindExtensions({ mode: "rpc" }); }
  catch (error) { session.dispose(); throw error; }
  return {
    async run() {
      await session.prompt("Run the synthetic shipping knowledge check.");
      expect(session.agent.state.errorMessage).toBeUndefined(); expect(modelCalls).toBe(3);
      const path = manager.getSessionFile(); expect(path).toBeTruthy();
      const reopened = SessionManager.open(path!);
      const assistants = reopened.getEntries().filter(entry => entry.type === "message" && entry.message.role === "assistant");
      expect(assistants).toHaveLength(3);
      expect(assistants[0]).toMatchObject({ message: { content: [{ type: "toolCall", name: "viking_team_search", id: "loop-search" }] } });
      expect(assistants[1]).toMatchObject({ message: { content: [{ type: "toolCall", name: "viking_team_read", id: "loop-read" }] } });
      const results = reopened.getEntries().filter(entry => entry.type === "message" && entry.message.role === "toolResult");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ message: { toolCallId: "loop-search", toolName: "viking_team_search", isError: false } });
      expect(results[1]).toMatchObject({ message: { toolCallId: "loop-read", toolName: "viking_team_read", isError: false,
        details: { provider: "newmoney-team-knowledge", document: input.document } } });
      expect(() => assertPrivateMemoryProvenance(reopened)).toThrow();
      await authorizeTeamHistory(reopened, input.model, { teamKnowledgeAccess: input.access, authorizeTeamSession: input.authorizeTeamSession });
    },
    async assertReplayDenied(expectedError: RegExp) {
      const before = modelCalls;
      await session.prompt("Do not process revoked team history.");
      expect(modelCalls).toBe(before); expect(session.agent.state.errorMessage).toMatch(expectedError);
      expect(() => assertPrivateMemoryProvenance(manager)).toThrow();
    },
    async close() { await session.abort(); session.dispose(); }
  };
}
