import { stat } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const ZERO_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })
});

export async function createPerformanceSessionFixture({ cwd, sessionDir, messageCount = 1_000 }) {
  if (!cwd || !sessionDir) throw new Error("cwd and sessionDir are required for the Pi performance fixture.");
  if (!Number.isInteger(messageCount) || messageCount < 1) {
    throw new Error("messageCount must be a positive integer.");
  }

  const manager = SessionManager.create(cwd, sessionDir);
  const timestamp = Date.now();
  for (let index = 0; index < messageCount; index += 1) {
    manager.appendMessage(index % 2 === 0
      ? {
          role: "user",
          content: `Pi-67 restore fixture user message ${index}.`,
          timestamp: timestamp + index
        }
      : {
          role: "assistant",
          content: [{ type: "text", text: `Pi-67 restore fixture assistant message ${index}.` }],
          api: "openai-responses",
          provider: "pi67-performance",
          model: "fixture",
          usage: ZERO_USAGE,
          stopReason: "stop",
          timestamp: timestamp + index
        });
  }

  return validateFixture(manager, cwd, sessionDir, messageCount);
}

export async function createPerformanceCodeSessionFixture({ cwd, sessionDir, lineCount = 500 }) {
  if (!cwd || !sessionDir) throw new Error("cwd and sessionDir are required for the Pi code fixture.");
  if (!Number.isInteger(lineCount) || lineCount < 1) throw new Error("lineCount must be a positive integer.");
  const code = Array.from({ length: lineCount }, (_, index) => (
    `export const packaged_fixture_${index}: number = (${index} * 17) % 997;`
  )).join("\n");
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({
    role: "user",
    content: `\`\`\`typescript\n${code}\n\`\`\``,
    timestamp: Date.now()
  });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Packaged code fixture ready." }],
    api: "openai-responses",
    provider: "pi67-performance",
    model: "fixture",
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp: Date.now() + 1
  });
  return { ...await validateFixture(manager, cwd, sessionDir, 2), lineCount };
}

async function validateFixture(manager, cwd, sessionDir, expectedMessageCount) {
  const sessionPath = manager.getSessionFile();
  if (!sessionPath) throw new Error("SessionManager did not persist the performance fixture.");
  const restored = SessionManager.open(sessionPath, sessionDir, cwd);
  const restoredMessages = restored.buildSessionContext().messages;
  const messageEntries = restored.getEntries().filter((entry) => entry.type === "message");
  if (restoredMessages.length !== expectedMessageCount || messageEntries.length !== expectedMessageCount) {
    throw new Error(
      `Pi fixture validation failed: context=${restoredMessages.length}, entries=${messageEntries.length}, expected=${expectedMessageCount}.`
    );
  }
  return { sessionPath, messageCount: expectedMessageCount, byteLength: (await stat(sessionPath)).size };
}
