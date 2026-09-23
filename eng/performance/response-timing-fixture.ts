import { writeFile } from "node:fs/promises";

/** Offline Pi provider: two independently delayed stream phases, no transport. */
export async function writeResponseTimingFixture(extensionPath: string): Promise<void> {
  await writeFile(extensionPath, `
    import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
    export default function responseTimingFixture(pi) {
      pi.registerProvider("timing-fixture", {
        name: "Offline timing fixture", baseUrl: "https://timing-fixture.invalid",
        apiKey: "synthetic-only", api: "openai-completions",
        models: [{ id: "timed", name: "Offline timed stream", reasoning: true,
          input: ["text"], contextWindow: 8192, maxTokens: 128,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
        streamSimple(model) {
          const stream = createAssistantMessageEventStream();
          const output = { role: "assistant", content: [], api: model.api,
            provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          void (async () => {
            stream.push({ type: "start", partial: output });
            await new Promise(resolve => setTimeout(resolve, 40));
            output.content.push({ type: "thinking", thinking: "synthetic thought" });
            stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
            stream.push({ type: "thinking_delta", contentIndex: 0, delta: "synthetic thought", partial: output });
            stream.push({ type: "thinking_end", contentIndex: 0, content: "synthetic thought", partial: output });
            await new Promise(resolve => setTimeout(resolve, 80));
            output.content.push({ type: "text", text: "synthetic answer" });
            stream.push({ type: "text_start", contentIndex: 1, partial: output });
            stream.push({ type: "text_delta", contentIndex: 1, delta: "synthetic answer", partial: output });
            stream.push({ type: "text_end", contentIndex: 1, content: "synthetic answer", partial: output });
            stream.push({ type: "done", reason: "stop", message: output });
            stream.end();
          })();
          return stream;
        }
      });
    }
  `, "utf8");
}
