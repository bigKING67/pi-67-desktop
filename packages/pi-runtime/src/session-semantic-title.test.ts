import type { AgentSession, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  SESSION_SEMANTIC_TITLE_ENTRY_TYPE,
  SessionSemanticTitleGenerator,
  automaticTitleFromBranch,
  sessionSemanticTitleMetadata
} from "./session-semantic-title.js";

describe("semantic Session titles", () => {
  it("keeps the first meaningful user request as the stable seed", () => {
    expect(automaticTitleFromBranch([
      message("u0", null, "user", "继续吧"),
      message("u1", "u0", "user", "优化 Session 搜索性能"),
      message("a1", "u1", "assistant", "已经定位索引热路径。"),
      message("u2", "a1", "user", "现在顺便把标题也改一下")
    ])).toEqual({ title: "优化 Session 搜索性能", source: "seed" });
  });

  it("prefers generated metadata on the current branch", () => {
    const generated = custom("t1", "a1", {
      version: 1,
      status: "generated",
      title: "统一会话搜索与索引",
      basedOnEntryId: "a1",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      generatedAt: 100
    });
    expect(automaticTitleFromBranch([
      message("u1", null, "user", "先做搜索"),
      message("a1", "u1", "assistant", "完成。"),
      generated,
      message("u2", "t1", "user", "继续吧")
    ])).toEqual({ title: "统一会话搜索与索引", source: "generated" });
    expect(sessionSemanticTitleMetadata(generated)).toMatchObject({ status: "generated" });
  });

  it("uses the selected model once, excludes Tool payloads, and persists bounded metadata", async () => {
    const branch = [
      message("u1", null, "user", `实现统一搜索 ${"上下文".repeat(2_000)}`),
      message("tool", "u1", "toolResult", "PRIVATE TOOL PAYLOAD"),
      message("a1", "tool", "assistant", "已确认需要可重建的本地索引。")
    ];
    const completeSimple = vi.fn(async (..._args: unknown[]) => assistantResponse("会话内容统一搜索"));
    const persistProjection = vi.fn(async () => undefined);
    const session = sessionFixture(branch, completeSimple);
    const generator = new SessionSemanticTitleGenerator({
      isCurrent: () => true,
      persistProjection
    });

    await expect(generator.generate(session, 3, "automatic"))
      .resolves.toEqual({ kind: "generated", title: "会话内容统一搜索" });
    expect(completeSimple).toHaveBeenCalledOnce();
    expect(completeSimple.mock.calls[0]?.[0]).toMatchObject({
      provider: "deepseek",
      id: "deepseek-v4-flash"
    });
    const context = completeSimple.mock.calls[0]?.[1] as { messages: Array<{ content: string }> };
    expect(context.messages[0]?.content).not.toContain("PRIVATE TOOL PAYLOAD");
    expect(context.messages[0]?.content.length).toBeLessThanOrEqual(8_000);
    expect(completeSimple.mock.calls[0]?.[2]).toMatchObject({ temperature: 0.1, maxTokens: 128 });
    expect(branch.at(-1)).toMatchObject({
      type: "custom",
      customType: SESSION_SEMANTIC_TITLE_ENTRY_TYPE,
      data: {
        version: 1,
        status: "generated",
        title: "会话内容统一搜索",
        basedOnEntryId: "a1",
        provider: "deepseek",
        model: "deepseek-v4-flash"
      }
    });
    expect(JSON.stringify(branch.at(-1))).not.toContain("实现统一搜索");
    expect(persistProjection).toHaveBeenCalledOnce();
    await expect(generator.generate(session, 3, "automatic"))
      .resolves.toEqual({ kind: "skipped", reason: "attempted" });
    expect(completeSimple).toHaveBeenCalledOnce();
  });

  it("does not generate automatically over an explicit title", async () => {
    const completeSimple = vi.fn(async () => assistantResponse("不应写入"));
    const session = sessionFixture([
      message("u1", null, "user", "实现搜索"),
      message("a1", "u1", "assistant", "完成。")
    ], completeSimple, "用户固定标题");
    const generator = new SessionSemanticTitleGenerator({
      isCurrent: () => true,
      persistProjection: vi.fn(async () => undefined)
    });
    await expect(generator.generate(session, 1, "automatic"))
      .resolves.toEqual({ kind: "skipped", reason: "explicit" });
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it("drops a stale completion without writing metadata", async () => {
    let resolve!: (value: ReturnType<typeof assistantResponse>) => void;
    const completeSimple = vi.fn(() => new Promise<ReturnType<typeof assistantResponse>>((done) => { resolve = done; }));
    const branch = [
      message("u1", null, "user", "实现搜索"),
      message("a1", "u1", "assistant", "完成。")
    ];
    let current = true;
    const persistProjection = vi.fn(async () => undefined);
    const session = sessionFixture(branch, completeSimple);
    const generator = new SessionSemanticTitleGenerator({
      isCurrent: () => current,
      persistProjection
    });
    const pending = generator.generate(session, 1, "automatic");
    current = false;
    resolve(assistantResponse("过期标题"));
    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(branch).toHaveLength(2);
    expect(persistProjection).not.toHaveBeenCalled();
  });

  it("records bounded automatic failure metadata and exposes manual failure", async () => {
    const automaticBranch = [
      message("u1", null, "user", "实现搜索"),
      message("a1", "u1", "assistant", "完成。")
    ];
    const failing = vi.fn(async () => { throw new Error("private provider detail"); });
    const automaticSession = sessionFixture(automaticBranch, failing);
    const automatic = new SessionSemanticTitleGenerator({
      isCurrent: () => true,
      persistProjection: vi.fn(async () => undefined)
    });
    await expect(automatic.generate(automaticSession, 1, "automatic"))
      .resolves.toEqual({ kind: "skipped", reason: "attempted" });
    expect(automaticBranch.at(-1)).toMatchObject({
      type: "custom",
      data: { status: "failed", reason: "provider" }
    });
    expect(JSON.stringify(automaticBranch.at(-1))).not.toContain("private provider detail");

    const manualBranch = [
      message("u2", null, "user", "实现标题"),
      message("a2", "u2", "assistant", "完成。")
    ];
    const manual = new SessionSemanticTitleGenerator({
      isCurrent: () => true,
      persistProjection: vi.fn(async () => undefined)
    });
    await expect(manual.generate(sessionFixture(manualBranch, failing), 1, "manual"))
      .rejects.toMatchObject({ code: "INTERNAL", recoverable: true });
  });
});

type CompleteSimple = (...args: unknown[]) => Promise<ReturnType<typeof assistantResponse>>;

function sessionFixture(
  branch: SessionEntry[],
  completeSimple: CompleteSimple,
  explicitName?: string
): AgentSession {
  const manager = {
    getBranch: () => branch,
    getSessionName: () => explicitName,
    appendCustomEntry: (customType: string, data: unknown) => {
      const id = `custom-${branch.length}`;
      branch.push(custom(id, branch.at(-1)?.id ?? null, data, customType));
      return id;
    }
  };
  return {
    model: {
      provider: "deepseek",
      id: "deepseek-v4-flash",
      maxTokens: 4_096
    },
    modelRuntime: { completeSimple },
    sessionManager: manager
  } as unknown as AgentSession;
}

function message(
  id: string,
  parentId: string | null,
  role: "user" | "assistant" | "toolResult",
  text: string
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-08-24T00:00:00.000Z",
    message: {
      role,
      content: [{ type: "text", text }],
      timestamp: 1
    }
  } as SessionEntry;
}

function custom(
  id: string,
  parentId: string | null,
  data: unknown,
  customType = SESSION_SEMANTIC_TITLE_ENTRY_TYPE
): SessionEntry {
  return {
    type: "custom",
    id,
    parentId,
    timestamp: "2026-08-24T00:00:00.000Z",
    customType,
    data
  } as SessionEntry;
}

function assistantResponse(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    provider: "deepseek",
    model: "deepseek-v4-flash",
    api: "openai-responses" as const,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp: 1
  };
}
