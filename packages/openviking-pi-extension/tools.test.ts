import { describe, expect, it, vi } from "vitest";
import { registerTools } from "./tools.js";

describe("viking_search cheap-first execution", () => {
  it("returns a strong cheap result without Query Expansion and caches it", async () => {
    const find = vi.fn().mockResolvedValue([
      result("viking://strong", 0.9),
      result("viking://weak", 0.55)
    ]);
    const searchContext = vi.fn();
    const tool = registeredSearchTool({ find, searchContext });

    const first = await tool.execute("call-1", { query: "host recovery", limit: 2 }, new AbortController().signal);
    const second = await tool.execute("call-2", { query: "host recovery", limit: 2 }, new AbortController().signal);
    expect((first.details as { mode: string }).mode).toBe("find-fast");
    expect(second).toEqual(first);
    expect(find).toHaveBeenCalledTimes(1);
    expect(searchContext).not.toHaveBeenCalled();
  });

  it("upgrades ambiguous cheap results to session-aware search once", async () => {
    const find = vi.fn().mockResolvedValue([
      result("viking://a", 0.82),
      result("viking://b", 0.78)
    ]);
    const searchContext = vi.fn().mockResolvedValue({
      entries: [{ uri: "viking://expanded", category: "experience", detail: "abstract", score: 0.93, text: "verified path" }],
      rendered: "",
      digest: "",
      stats: {}
    });
    const tool = registeredSearchTool({ find, searchContext });

    const value = await tool.execute("call", { query: "ambiguous recovery" }, new AbortController().signal);
    expect((value.details as { mode: string }).mode).toBe("session-context");
    expect(find).toHaveBeenCalledTimes(1);
    expect(searchContext).toHaveBeenCalledTimes(1);
    expect(searchContext).toHaveBeenCalledWith("ambiguous recovery", { sessionId: "session-1", limit: 5 });
  });
});

function registeredSearchTool(overrides: { find: ReturnType<typeof vi.fn>; searchContext: ReturnType<typeof vi.fn> }) {
  const registered: Array<{ name: string; execute: (...args: any[]) => Promise<any> }> = [];
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
    find: overrides.find,
    searchContext: overrides.searchContext
  } as any, { sessionId: "session-1" } as any);
  return registered.find((tool) => tool.name === "viking_search")!;
}

function result(uri: string, score: number) {
  return { uri, context_type: "memory", score, abstract: "abstract" };
}
