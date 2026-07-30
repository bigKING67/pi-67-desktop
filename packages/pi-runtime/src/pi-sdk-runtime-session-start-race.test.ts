import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

const temporaryDirectories: string[] = [];
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime session-start projection binding", () => {
  it("keeps imported messages when an async session-start handler changes the model", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-session-start-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const externalSessions = join(root, "external-sessions");
    await Promise.all([
      mkdir(cwd),
      mkdir(extensionsDirectory, { recursive: true }),
      mkdir(externalSessions)
    ]);
    await writeFile(join(extensionsDirectory, "session-start-model.ts"), `
      export default function sessionStartModel(pi) {
        pi.registerProvider("pi67-session-start", {
          baseUrl: "https://pi67.invalid",
          apiKey: "pi67-session-start-fixture",
          api: "openai-responses",
          models: [{
            id: "fixture",
            name: "Session start fixture",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 4096,
            maxTokens: 256
          }]
        });
        pi.on("session_start", async (_event, ctx) => {
          const model = ctx.modelRegistry.find("pi67-session-start", "fixture");
          if (model) await pi.setModel(model);
        });
      }
    `, "utf8");

    const external = SessionManager.create(cwd, externalSessions);
    external.appendMessage({ role: "user", content: "Preserve the imported branch.", timestamp: 1 });
    external.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Imported branch preserved." }],
      api: "openai-responses",
      provider: "pi67-test",
      model: "fixture",
      usage: zeroUsage,
      stopReason: "stop",
      timestamp: 2
    });
    const externalPath = external.getSessionFile();
    if (!externalPath) throw new Error("The external Pi Session fixture was not persisted.");

    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" });
      const snapshot = await runtime.importSession(externalPath);
      const page = runtime.getMessagePage({ direction: "older", limit: 100 });

      expect(snapshot.messages).toHaveLength(2);
      expect(snapshot.messagePage).toMatchObject({ hasOlder: false, hasNewer: false });
      expect(page.messages).toHaveLength(2);
      expect(page.messages).toEqual(snapshot.messages);
    } finally {
      await runtime.dispose();
    }
  });
});
