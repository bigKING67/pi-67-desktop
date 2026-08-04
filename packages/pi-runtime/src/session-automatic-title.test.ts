import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { SessionAutomaticTitleReader } from "./session-automatic-title.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SessionAutomaticTitleReader", () => {
  it("walks only the current Pi branch and skips non-topical follow-ups", async () => {
    const root = await temporaryRoot();
    const manager = SessionManager.create(root, root);
    const topic = manager.appendMessage({ role: "user", content: "修复冷启动对话标题", timestamp: Date.now() });
    manager.appendMessage(assistant("旧分支回复"));
    manager.branch(topic);
    manager.appendMessage({ role: "user", content: "继续吧", timestamp: Date.now() + 2 });

    await expect(new SessionAutomaticTitleReader().read(manager.getSessionFile()!))
      .resolves.toBe("修复冷启动对话标题");
  });

  it("invalidates its cache when a multilingual Session is appended", async () => {
    const root = await temporaryRoot();
    const manager = SessionManager.create(root, root);
    manager.appendMessage({ role: "user", content: "第一轮问题", timestamp: Date.now() });
    manager.appendMessage(assistant("第一轮回复"));
    const reader = new SessionAutomaticTitleReader();
    await expect(reader.read(manager.getSessionFile()!)).resolves.toBe("第一轮问题");
    manager.appendMessage({ role: "user", content: "第二轮 café 问题", timestamp: Date.now() + 1 });
    await expect(reader.read(manager.getSessionFile()!)).resolves.toBe("第二轮 café 问题");
  });
});

function assistant(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "test",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp: Date.now() + 1
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-automatic-title-"));
  roots.push(root);
  return root;
}
