import type { HighlightToken } from "./code-highlighter-worker-core.js";

export type { HighlightToken } from "./code-highlighter-worker-core.js";

export interface HighlightRequest {
  id: number;
  code: string;
  language?: string;
}

interface HighlightSuccess {
  id: number;
  ok: true;
  lines: HighlightToken[][];
  resources: string[];
}

interface HighlightFailure {
  id: number;
  ok: false;
  error: string;
}

export type HighlightResponse = HighlightSuccess | HighlightFailure;

export interface HighlightWorker {
  addEventListener(type: "message", listener: (event: MessageEvent<HighlightResponse>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  postMessage(request: HighlightRequest): void;
  terminate(): void;
}

interface PendingHighlight {
  resolve: (lines: HighlightToken[][]) => void;
  reject: (error: Error) => void;
}

export interface CodeHighlighterBridge {
  highlight(code: string, language: string | undefined): Promise<HighlightToken[][]>;
  dispose(): void;
}

export function createCodeHighlighterBridge(
  createWorker: () => HighlightWorker
): CodeHighlighterBridge {
  let worker: HighlightWorker | undefined;
  let nextRequestId = 0;
  const pending = new Map<number, PendingHighlight>();

  const resetWorker = (message: string): void => {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };

  const getWorker = (): HighlightWorker => {
    if (worker) return worker;
    worker = createWorker();
    worker.addEventListener("message", (event) => {
      const response = event.data;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.ok) {
        performance.mark("pi67-code-highlight-resources", { detail: response.resources });
        request.resolve(response.lines);
      } else request.reject(new Error(response.error));
    });
    worker.addEventListener("error", () => resetWorker("Syntax-highlighting worker failed."));
    worker.addEventListener("messageerror", () => resetWorker("Syntax-highlighting worker returned invalid data."));
    return worker;
  };

  return {
    highlight(code, language) {
      const id = nextRequestId = (nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request: HighlightRequest = {
          id,
          code,
          ...(language === undefined ? {} : { language })
        };
        try {
          getWorker().postMessage(request);
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      resetWorker("Syntax-highlighting worker was disposed.");
    }
  };
}

const defaultBridge = createCodeHighlighterBridge(() => new Worker(
  new URL("./code-highlighter.worker.ts", import.meta.url),
  { type: "module", name: "pi67-code-highlighter" }
));

export function highlightCode(
  code: string,
  language: string | undefined
): Promise<HighlightToken[][]> {
  return defaultBridge.highlight(code, language);
}
