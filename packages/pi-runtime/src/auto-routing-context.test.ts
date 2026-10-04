import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type InlineExtension,
  type SessionEntry
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Provider
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  AUTO_MODEL_ID,
  AUTO_MODEL_PROVIDER,
  bindDesktopAutoRouting,
  registerDesktopAutoCatalog
} from "./auto-routing.js";
import { AUTO_ROUTING_ENTRY } from "./auto-routing-evidence.js";
import { createAutoRoutingFixture, selection } from "./auto-routing.test-support.js";
import { createDesktopPlanModeExtension } from "./plan-mode-tools.js";

describe("Desktop Auto routing task context", () => {
  it("classifies the real user task when the native PLAN extension adds its custom context", async () => {
    const fixture = await createContextFixture(createDesktopPlanModeExtension(() => "plan"));
    try {
      await fixture.session.prompt("Plan a one-line typo fix");

      expect(fixture.session.messages.some((message) => (
        "content" in message && typeof message.content === "string"
        && message.content.startsWith("[PI-67 PLAN MODE ACTIVE]")
      ))).toBe(true);
      expect(fixture.judgeInputs).toEqual(["Plan a one-line typo fix"]);
      expect(fixture.calls).toEqual([
        { kind: "judge", model: "judge" },
        { kind: "candidate", model: "standard" }
      ]);
      expect(fixture.session.agent.state.errorMessage).toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });

  it("does not classify a custom before-agent-start message as the task", async () => {
    const fixture = await createContextFixture({
      name: "synthetic-auto-context",
      hidden: true,
      factory: (pi) => {
        pi.on("before_agent_start", () => ({
          message: { customType: "fixture.context", content: "[INJECTED CONTEXT]", display: false }
        }));
      }
    });
    try {
      await fixture.session.prompt("Review the retry boundary");

      expect(fixture.judgeInputs).toEqual(["Review the retry boundary"]);
      expect(fixture.calls).toEqual([
        { kind: "judge", model: "judge" },
        { kind: "candidate", model: "standard" }
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  it("publishes the persisted routing decision before Pi dispatches the candidate", async () => {
    const entries: SessionEntry[] = [];
    const callsAtPublish: Array<Array<{ kind: "judge" | "candidate"; model: string }>> = [];
    let fixture: Awaited<ReturnType<typeof createAutoRoutingFixture>>;
    fixture = await createAutoRoutingFixture({
      onRoutingEntry: (entry) => {
        entries.push(entry);
        callsAtPublish.push([...fixture.providerCalls]);
      }
    });
    try {
      await fixture.session.prompt("Apply a one-line typo fix");

      expect(callsAtPublish).toEqual([[{ kind: "judge", model: "judge" }]]);
      expect(entries).toEqual([expect.objectContaining({
        type: "custom",
        customType: AUTO_ROUTING_ENTRY,
        data: expect.objectContaining({ status: "selected", selected: selection().standard })
      })]);
      expect(fixture.manager.getEntries()).toContainEqual(entries[0]);
      expect(fixture.providerCalls).toEqual([
        { kind: "judge", model: "judge" },
        { kind: "candidate", model: "standard" }
      ]);
    } finally {
      await fixture.dispose();
    }
  });
});

async function createContextFixture(extension: InlineExtension) {
  const root = await mkdtemp(join(tmpdir(), "pi67-auto-routing-context-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
    pi67Desktop: { autoRouting: selection() }
  }), "utf8");
  const judgeInputs: string[] = [];
  const calls: Array<{ kind: "judge" | "candidate"; model: string }> = [];
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
      extensionFactories: [extension]
    }
  });
  services.modelRuntime.registerNativeProvider(syntheticProvider(judgeInputs, calls));
  await services.modelRuntime.setRuntimeApiKey("fixture", "synthetic");
  registerDesktopAutoCatalog(services.modelRuntime, services.settingsManager);
  const auto = services.modelRuntime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID);
  if (!auto) throw new Error("Expected the synthetic Auto model.");
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
    model: auto
  });
  await session.bindExtensions({ mode: "rpc" });
  await bindDesktopAutoRouting(session);
  return {
    session,
    judgeInputs,
    calls,
    async dispose() {
      session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  };
}

function syntheticProvider(
  judgeInputs: string[],
  calls: Array<{ kind: "judge" | "candidate"; model: string }>
): Provider<"openai-responses"> {
  const models = ["judge", "standard", "complex"].map(model);
  return {
    id: "fixture",
    name: "Synthetic Auto context",
    auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic" } }) } },
    getModels: () => models,
    stream(current, _context, request) {
      request?.signal?.throwIfAborted();
      calls.push({ kind: "candidate", model: current.id });
      return complete(current, [{ type: "text", text: `candidate:${current.id}` }]);
    },
    streamSimple(current, context, request) {
      request?.signal?.throwIfAborted();
      if (current.id !== "judge") {
        calls.push({ kind: "candidate", model: current.id });
        return complete(current, [{ type: "text", text: `candidate:${current.id}` }]);
      }
      calls.push({ kind: "judge", model: current.id });
      const user = context.messages.findLast((message) => message.role === "user");
      judgeInputs.push(typeof user?.content === "string" ? user.content : "");
      return complete(current, [{ type: "text", text: JSON.stringify({ complexity: "standard" }) }]);
    }
  };
}

function model(id: string): Model<"openai-responses"> {
  return {
    id,
    name: id,
    provider: "fixture",
    api: "openai-responses",
    baseUrl: "https://synthetic.invalid/v1",
    input: ["text"],
    reasoning: false,
    contextWindow: 32_768,
    maxTokens: 1_024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
}

function complete(model: Model<"openai-responses">, content: AssistantMessage["content"]) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message: {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    timestamp: Date.now(),
    stopReason: "stop",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  } });
  return stream;
}
