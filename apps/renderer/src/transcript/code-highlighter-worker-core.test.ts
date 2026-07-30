import { describe, expect, it, vi } from "vitest";
import { createCodeHighlighterWorkerCore } from "./code-highlighter-worker-core.js";

describe("code highlighter Worker core", () => {
  it("uses a line-preserving plain-text fallback for unknown languages", async () => {
    const loadLanguage = vi.fn(async () => undefined);
    const tokenize = vi.fn(async () => []);
    const core = createCodeHighlighterWorkerCore({ aliases: { ts: "typescript" }, loadLanguage, tokenize });

    await expect(core.highlight({ id: 1, code: "alpha\nbeta", language: "unknown" })).resolves.toEqual([
      [{ content: "alpha" }],
      [{ content: "beta" }]
    ]);
    expect(loadLanguage).not.toHaveBeenCalled();
    expect(tokenize).not.toHaveBeenCalled();
  });

  it("normalizes aliases and deduplicates concurrent language loads", async () => {
    let finishLoading!: () => void;
    const loadLanguage = vi.fn(() => new Promise<void>((resolve) => {
      finishLoading = resolve;
    }));
    const tokenize = vi.fn(async (code: string, language: string) => [[{ content: `${language}:${code}` }]]);
    const core = createCodeHighlighterWorkerCore({ aliases: { ts: "typescript" }, loadLanguage, tokenize });

    const first = core.highlight({ id: 1, code: "one", language: "TS" });
    const second = core.highlight({ id: 2, code: "two", language: "ts" });
    expect(loadLanguage).toHaveBeenCalledOnce();
    finishLoading();

    await expect(first).resolves.toEqual([[{ content: "typescript:one" }]]);
    await expect(second).resolves.toEqual([[{ content: "typescript:two" }]]);
    expect(tokenize).toHaveBeenCalledTimes(2);
  });

  it("clears a failed pending load so the language can be retried", async () => {
    const loadLanguage = vi.fn()
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce(undefined);
    const tokenize = vi.fn(async () => [[{ content: "ready" }]]);
    const core = createCodeHighlighterWorkerCore({ aliases: { ts: "typescript" }, loadLanguage, tokenize });

    await expect(core.highlight({ id: 1, code: "one", language: "ts" })).rejects.toThrow("load failed");
    await expect(core.highlight({ id: 2, code: "two", language: "ts" })).resolves.toEqual([
      [{ content: "ready" }]
    ]);
    expect(loadLanguage).toHaveBeenCalledTimes(2);
  });
});
