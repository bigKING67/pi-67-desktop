import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamingMarkdownParser, type MarkdownParseWorker } from "./streaming-markdown-parser.js";

function fixture() {
  const postMessage = vi.fn();
  const terminate = vi.fn();
  const worker: MarkdownParseWorker = {
    onmessage: null, onerror: null, onmessageerror: null,
    postMessage, terminate
  };
  const publish = vi.fn();
  const fail = vi.fn();
  const parser = createStreamingMarkdownParser(worker, publish, fail);
  const complete = (id: number) => worker.onmessage?.({
    data: { id, ok: true, tree: { type: "root", children: [] } }
  } as MessageEvent);
  return { worker, postMessage, terminate, publish, fail, parser, complete };
}

afterEach(() => vi.useRealTimers());

describe("streaming Markdown parser ownership", () => {
  it("keeps one in-flight parse and only the latest queued source without starving completed prefixes", () => {
    const { postMessage, publish, parser, complete } = fixture();
    parser.update("first");
    parser.update("second");
    parser.update("third");
    expect(postMessage).toHaveBeenCalledTimes(1);
    complete(1);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ source: "first" }));
    expect(postMessage).toHaveBeenLastCalledWith({ id: 2, source: "third" });
    complete(2);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ source: "third" }));
    parser.dispose();
  });

  it("terminates and suppresses callbacks after the document is unmounted or settled", () => {
    const { worker, postMessage, terminate, publish, parser } = fixture();
    parser.update("old session");
    parser.update("queued old session");
    const late = worker.onmessage!;
    parser.dispose();
    parser.dispose();
    late({ data: { id: 1, ok: true, tree: { type: "root", children: [] } } } as MessageEvent);
    parser.update("after dispose");
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("fails once and clears the pending work when the worker stalls", () => {
    vi.useFakeTimers();
    const { terminate, fail, publish, parser, complete } = fixture();
    parser.update("first");
    parser.update("latest");
    vi.advanceTimersByTime(5_000);
    complete(1);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("fails closed for a mismatched response and rejects text beyond the UTF-8 budget", () => {
    const first = fixture();
    first.parser.update("source");
    first.complete(7);
    expect(first.fail).toHaveBeenCalledTimes(1);
    expect(first.publish).not.toHaveBeenCalled();
    const second = fixture();
    second.parser.update("中".repeat(22_000));
    expect(second.fail).toHaveBeenCalledTimes(1);
    expect(second.postMessage).not.toHaveBeenCalled();
  });

  it("handles worker errors and synchronous post failures without retaining the worker", () => {
    const first = fixture();
    first.worker.onerror?.(new Event("error") as ErrorEvent);
    expect(first.fail).toHaveBeenCalledTimes(1);
    const second = fixture();
    second.postMessage.mockImplementation(() => { throw new Error("clone failed"); });
    second.parser.update("source");
    expect(second.fail).toHaveBeenCalledTimes(1);
    expect(second.terminate).toHaveBeenCalledTimes(1);
  });
});
