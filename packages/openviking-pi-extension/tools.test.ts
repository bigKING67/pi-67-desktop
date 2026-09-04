import { describe, expect, it, vi } from "vitest";
import { registerTools } from "./tools.js";

describe("viking_search official on-demand execution", () => {
  it("uses exactly one bounded find request per invocation without context expansion or a hidden cache", async () => {
    const find = vi.fn().mockResolvedValue([
      result("viking://strong", 0.9),
      result("viking://weak", 0.55)
    ]);
    const tool = registeredSearchTool(find);

    const first = await tool.execute("call-1", { query: "host recovery", limit: 2 }, new AbortController().signal);
    const second = await tool.execute("call-2", { query: "host recovery", limit: 2 }, new AbortController().signal);
    expect((first.details as { mode: string }).mode).toBe("official-find");
    expect((first.content as Array<{ text: string }>)[0]?.text).toContain(
      '<pi67-memory-tool-result provider="openviking" trust="untrusted" kind="search">',
    );
    expect(second).toEqual(first);
    expect(find).toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenNthCalledWith(1, "host recovery", {
      topK: 2,
      timeoutMs: 1_000
    });
  });

  it("preserves an explicit URI scope and exposes the no-duplicate-search policy", async () => {
    const find = vi.fn().mockResolvedValue([result("viking://scoped", 0.82)]);
    const tool = registeredSearchTool(find);

    const value = await tool.execute("call", {
      query: "workspace recovery",
      scope: "viking://user/memories/"
    }, new AbortController().signal);
    expect((value.details as { mode: string }).mode).toBe("scoped-find");
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith("workspace recovery", {
      targetUri: "viking://user/memories/",
      topK: 10,
      timeoutMs: 1_000
    });
    expect(tool.promptGuidelines.join(" ")).toContain("Do not call when the current prompt's inline OpenViking context already answers the need.");
  });
});

function registeredSearchTool(find: ReturnType<typeof vi.fn>) {
  const registered: Array<{
    name: string;
    promptGuidelines: string[];
    execute: (...args: any[]) => Promise<any>;
  }> = [];
  registerTools({ registerTool: (tool: any) => registered.push(tool) }, {
    connected: true,
    cfg: {
      minQueryLength: 3,
      recallMaxContentChars: 500,
      recallTimeoutMs: 1_000,
      scoreThreshold: 0.35,
      recallTokenBudget: 1_200,
      peerId: "peer-1",
      privacyMode: "private-learning"
    },
    health: vi.fn().mockResolvedValue(true),
    find
  } as any, { sessionId: "session-1" } as any);
  return registered.find((tool) => tool.name === "viking_search")!;
}

function result(uri: string, score: number) {
  return { uri, context_type: "memory", score, abstract: "abstract" };
}
