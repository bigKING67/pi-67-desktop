import { MAX_PROJECTED_TEXT_BYTES } from "@pi67/domain";
import type { Root } from "mdast";

export interface ParsedStreamingMarkdown {
  source: string;
  tree: Root;
}

export type MarkdownParseResponse =
  | { id: number; ok: true; tree: Root }
  | { id: number; ok: false };

export interface MarkdownParseWorker {
  onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: { id: number; source: string }): void;
  terminate(): void;
}

// One parse in flight and one replaceable pending source per mounted document.
// Completed prefixes remain usable while a newer source is being parsed.
export function createStreamingMarkdownParser(
  worker: MarkdownParseWorker,
  publish: (result: ParsedStreamingMarkdown) => void,
  fail: () => void
) {
  let disposed = false;
  let nextId = 0;
  let active: { id: number; source: string } | undefined;
  let pending: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    active = undefined;
    pending = undefined;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  const failed = () => {
    if (disposed) return;
    dispose();
    fail();
  };
  const send = (source: string) => {
    if (disposed) return;
    active = { id: ++nextId, source };
    timeout = setTimeout(failed, 5_000);
    try { worker.postMessage(active); } catch { failed(); }
  };
  worker.onmessage = ({ data }) => {
    if (disposed || !active) return;
    if (!data || data.id !== active.id || !data.ok || data.tree?.type !== "root" || !Array.isArray(data.tree.children)) {
      failed();
      return;
    }
    clearTimeout(timeout);
    const result = { source: active.source, tree: data.tree };
    active = undefined;
    publish(result);
    if (pending !== undefined) {
      const source = pending;
      pending = undefined;
      send(source);
    }
  };
  worker.onerror = failed;
  worker.onmessageerror = failed;
  return {
    update(source: string) {
      if (disposed) return;
      if (new TextEncoder().encode(source).byteLength > MAX_PROJECTED_TEXT_BYTES) {
        failed();
        return;
      }
      if (active) pending = source;
      else send(source);
    },
    dispose
  };
}
