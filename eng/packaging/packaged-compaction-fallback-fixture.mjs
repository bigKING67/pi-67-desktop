import { createServer } from "node:net";

export function packagedCompactionProviderSource(observationPath, apiKey) {
  return `
    import { appendFileSync, existsSync, readFileSync } from "node:fs";
    import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

    const observationPath = ${JSON.stringify(observationPath)};
    function observations() {
      if (!existsSync(observationPath)) return [];
      return readFileSync(observationPath, "utf8").split(/\\r?\\n/u).filter(Boolean).map((line) => JSON.parse(line));
    }
    function response(model, text, totalTokens) {
      const output = {
        role: "assistant",
        content: [{ type: "text", text }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: Math.max(1, totalTokens - 16),
          output: 16,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "stop",
        timestamp: Date.now()
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: output });
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
      return stream;
    }

    export default function packagedCompactionProvider(pi) {
      pi.registerProvider("pi67-compaction", {
        name: "Pi-67 Compaction Fixture",
        baseUrl: "https://pi67.invalid",
        apiKey: ${JSON.stringify(apiKey)},
        api: "openai-responses",
        models: [{
          id: "fixture",
          name: "Compaction Runtime",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 256
        }],
        streamSimple: (model, context) => {
          const serialized = JSON.stringify(context.messages ?? []);
          if (context.systemPrompt?.includes("stable navigation title")) {
            appendFileSync(observationPath, JSON.stringify({ kind: "title" }) + "\\n");
            return response(model, "Synthetic Compaction Fixture", 32);
          }
          if (context.systemPrompt?.includes("context summarization assistant") || serialized.includes("<conversation>")) {
            appendFileSync(observationPath, JSON.stringify({ kind: "summary" }) + "\\n");
            return response(model, "Synthetic Pi default compaction summary.", 96);
          }
          const turnIndex = observations().filter((entry) => entry.kind === "turn").length + 1;
          const fixtures = {
            1: ["Synthetic pre-compaction turn.", 700],
            2: ["Synthetic threshold turn.", 1800],
            3: ["Synthetic post-compaction continuation.", 500],
            4: ["Synthetic resumed continuation.", 600]
          };
          const fixture = fixtures[turnIndex] ?? ["Unexpected synthetic turn.", 400];
          appendFileSync(observationPath, JSON.stringify({
            kind: "turn",
            turnIndex,
            messageCount: context.messages?.length ?? 0
          }) + "\\n");
          return response(model, fixture[0], fixture[1]);
        }
      });
      pi.on("before_agent_start", async (_event, ctx) => {
        const model = ctx.modelRegistry.find("pi67-compaction", "fixture");
        if (model) await pi.setModel(model);
      });
    }
  `;
}

export function packagedCompactionObserverSource(observationPath) {
  return `
    import { appendFileSync } from "node:fs";
    const write = (entry) => appendFileSync(${JSON.stringify(observationPath)}, JSON.stringify(entry) + "\\n");
    export default function packagedCompactionObserver(pi) {
      pi.on("session_start", (event, ctx) => {
        write({ kind: "session-start", reason: event.reason, sessionId: ctx.sessionManager.getSessionId() });
      });
      pi.on("session_before_compact", (event) => {
        write({ kind: "before", reason: event.reason, willRetry: event.willRetry });
      });
      pi.on("session_compact", (event) => {
        write({
          kind: "after",
          reason: event.reason,
          willRetry: event.willRetry,
          fromExtension: event.fromExtension,
          fromHook: event.compactionEntry.fromHook === true
        });
      });
    }
  `;
}

export async function startUnavailableOpenVikingTrap() {
  let connectionAttempts = 0;
  const server = createServer((socket) => {
    connectionAttempts += 1;
    socket.destroy();
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unavailable OpenViking trap did not bind TCP.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    get connectionAttempts() { return connectionAttempts; },
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    })
  };
}
