export interface HighlightToken {
  content: string;
  color?: string;
}

interface HighlightRequest {
  id: number;
  code: string;
  language?: string;
  dark: boolean;
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

type HighlightResponse = HighlightSuccess | HighlightFailure;

interface PendingHighlight {
  resolve: (lines: HighlightToken[][]) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
let nextRequestId = 0;
const pending = new Map<number, PendingHighlight>();

export function highlightCode(
  code: string,
  language: string | undefined,
  dark: boolean
): Promise<HighlightToken[][]> {
  const id = nextRequestId = (nextRequestId + 1) % Number.MAX_SAFE_INTEGER;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: HighlightRequest = {
      id,
      code,
      ...(language === undefined ? {} : { language }),
      dark
    };
    getWorker().postMessage(request);
  });
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./code-highlighter.worker.ts", import.meta.url), {
    type: "module",
    name: "pi67-code-highlighter"
  });
  worker.addEventListener("message", (event: MessageEvent<HighlightResponse>) => {
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
}

function resetWorker(message: string): void {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
}
