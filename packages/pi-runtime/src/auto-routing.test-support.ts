import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type AgentSession,
  type SessionEntry,
  type ModelRuntime
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Provider
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  bindDesktopAutoRouting,
  registerDesktopAutoCatalog,
  AUTO_MODEL_ID,
  AUTO_MODEL_PROVIDER
} from "./auto-routing.js";

export type JudgeReply = "standard" | "complex" | "invalid" | "error" | "pending"
  | { text: string; stopReason?: "stop" | "length" };
export type CandidateReply = "stop" | "tool" | "error";

export interface AutoRoutingFixture {
  root: string;
  agentDir: string;
  services: Awaited<ReturnType<typeof createAgentSessionServices>>;
  runtime: ModelRuntime;
  manager: SessionManager;
  session: AgentSession;
  providerCalls: Array<{ kind: "judge" | "candidate"; model: string }>;
  judgeRequests: Array<{ model: string; maxTokens: number | undefined; temperature: number | undefined; text: string }>;
  setJudgeReply(reply: JudgeReply): void;
  setCandidateReplies(replies: CandidateReply[]): void;
  dispose(): Promise<void>;
}

export async function createAutoRoutingFixture(options: {
  judgeReply?: JudgeReply;
  candidateReplies?: CandidateReply[];
  imageStandard?: boolean;
  imageComplex?: boolean;
  trusted?: boolean;
  autoRouting?: boolean;
  useSavedDefault?: boolean;
  durable?: boolean;
  onRoutingEntry?: (entry: SessionEntry) => void;
} = {}): Promise<AutoRoutingFixture> {
  const root = await mkdtemp(join(tmpdir(), "pi67-auto-routing-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const sessionDirectory = join(root, "sessions");
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(sessionDirectory)]);
  if (options.autoRouting !== false) {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", images: { autoResize: false },
      ...(options.useSavedDefault ? { defaultProvider: "fixture", defaultModel: "standard" } : {}),
      pi67Desktop: { autoRouting: selection() }
    }), "utf8");
  }

  let judgeReply = options.judgeReply ?? "standard";
  let candidateReplies = [...(options.candidateReplies ?? ["stop"])];
  const providerCalls: AutoRoutingFixture["providerCalls"] = [];
  const judgeRequests: AutoRoutingFixture["judgeRequests"] = [];
  const services = await createAgentSessionServices({
    cwd,
    agentDir
  });
  if (options.trusted === false) services.settingsManager.setProjectTrusted(false);
  const provider = syntheticProvider({
    getJudgeReply: () => judgeReply,
    takeCandidateReply: () => candidateReplies.shift() ?? "stop",
    calls: providerCalls,
    judgeRequests,
    ...(options.imageStandard === undefined ? {} : { imageStandard: options.imageStandard }),
    ...(options.imageComplex === undefined ? {} : { imageComplex: options.imageComplex })
  });
  services.modelRuntime.registerNativeProvider(provider);
  await services.modelRuntime.setRuntimeApiKey("fixture", "synthetic");
  registerDesktopAutoCatalog(services.modelRuntime, services.settingsManager);
  const selected = options.autoRouting === false
    ? services.modelRuntime.getModel("fixture", "standard")
    : services.modelRuntime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID);
  if (!selected) throw new Error("Expected the requested synthetic model catalog entry.");
  const manager = options.durable === false ? SessionManager.inMemory(cwd) : SessionManager.create(cwd, sessionDirectory);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: manager,
    ...(options.useSavedDefault ? {} : { model: selected }),
    customTools: [{
      name: "fixture_tool",
      label: "Fixture tool",
      description: "Synthetic Auto-routing continuation fixture.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "fixture tool result" }], details: {} })
    }]
  });
  if (options.autoRouting !== false) await bindDesktopAutoRouting(session, options.onRoutingEntry);
  return {
    root, agentDir, services, runtime: services.modelRuntime, manager, session, providerCalls, judgeRequests,
    setJudgeReply(reply) { judgeReply = reply; },
    setCandidateReplies(replies) { candidateReplies = [...replies]; },
    async dispose() {
      session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  };
}

export function selection() {
  return {
    judge: { provider: "fixture", model: "judge" },
    standard: { provider: "fixture", model: "standard" },
    complex: { provider: "fixture", model: "complex" }
  };
}

function syntheticProvider(fixture: {
  getJudgeReply(): JudgeReply;
  takeCandidateReply(): CandidateReply;
  calls: AutoRoutingFixture["providerCalls"];
  judgeRequests: AutoRoutingFixture["judgeRequests"];
  imageStandard?: boolean;
  imageComplex?: boolean;
}): Provider<"openai-responses"> {
  const models = [
    model("judge", false),
    model("standard", fixture.imageStandard ?? false),
    model("complex", fixture.imageComplex ?? true)
  ];
  return {
    id: "fixture",
    name: "Synthetic Auto routing",
    auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic" } }) } },
    getModels: () => models,
    stream(model, _context, request) {
      request?.signal?.throwIfAborted();
      fixture.calls.push({ kind: "candidate", model: model.id });
      const reply = fixture.takeCandidateReply();
      if (reply === "error") throw new Error("synthetic candidate failure");
      return completed(model, reply === "tool" ? "toolUse" : "stop", reply === "tool"
        ? [{ type: "toolCall", id: `tool-${fixture.calls.length}`, name: "fixture_tool", arguments: {} }]
        : [{ type: "text", text: `candidate:${model.id}` }]
      );
    },
    streamSimple(model, context, request) {
      request?.signal?.throwIfAborted();
      if (model.id !== "judge") {
        fixture.calls.push({ kind: "candidate", model: model.id });
        const reply = fixture.takeCandidateReply();
        if (reply === "error") throw new Error("synthetic candidate failure");
        return completed(model, reply === "tool" ? "toolUse" : "stop", reply === "tool"
          ? [{ type: "toolCall", id: `tool-${fixture.calls.length}`, name: "fixture_tool", arguments: {} }]
          : [{ type: "text", text: `candidate:${model.id}` }]
        );
      }
      fixture.calls.push({ kind: "judge", model: model.id });
      const user = context.messages.findLast(message => message.role === "user");
      fixture.judgeRequests.push({
        model: model.id,
        maxTokens: request?.maxTokens,
        temperature: request?.temperature,
        text: (user ? (typeof user.content === "string" ? [user.content]
          : user.content.filter(part => part.type === "text").map(part => part.text)) : []
        ).join("\n")
      });
      const reply = fixture.getJudgeReply();
      if (reply === "error") throw new Error("synthetic judge failure");
      if (reply === "pending") return createAssistantMessageEventStream();
      if (typeof reply === "object") return completed(model, reply.stopReason ?? "stop", [{ type: "text", text: reply.text }]);
      return completed(model, "stop", [{ type: "text", text: reply === "invalid" ? "uncertain" : JSON.stringify({ complexity: reply }) }]);
    }
  };
}

function model(id: string, image: boolean): Model<"openai-responses"> {
  return {
    id,
    name: id,
    provider: "fixture",
    api: "openai-responses",
    baseUrl: "https://synthetic.invalid/v1",
    input: image ? ["text", "image"] : ["text"],
    reasoning: false,
    contextWindow: 32_768,
    maxTokens: 1_024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
}

function completed(
  model: Model<"openai-responses">,
  stopReason: "stop" | "toolUse" | "length",
  content: AssistantMessage["content"]
) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: stopReason, message: {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    timestamp: Date.now(),
    stopReason,
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  } });
  return stream;
}
