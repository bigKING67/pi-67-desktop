import { useEffect, useRef, useState } from "react";
import {
  createStreamingMarkdownParser,
  type ParsedStreamingMarkdown
} from "./streaming-markdown-parser.js";

const WORKER_MIN_SOURCE_CHARS = 8_192;

export function useStreamingMarkdown(source: string, streaming: boolean): ParsedStreamingMarkdown | undefined {
  const enabled = streaming && source.length >= WORKER_MIN_SOURCE_CHARS;
  const parser = useRef<ReturnType<typeof createStreamingMarkdownParser> | undefined>(undefined);
  const [parsed, setParsed] = useState<ParsedStreamingMarkdown | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const failed = () => {
      if (!mounted) return;
      parser.current = undefined;
      setParsed(undefined);
      console.warn("Streaming Markdown parser unavailable; using synchronous rendering.");
    };
    try {
      const worker = new Worker(new URL("./streaming-markdown-parser.worker.ts", import.meta.url), { type: "module" });
      const bridge = createStreamingMarkdownParser(worker, (result) => {
        if (mounted) setParsed(result);
      }, failed);
      parser.current = bridge;
    } catch {
      failed();
    }
    return () => {
      mounted = false;
      parser.current?.dispose();
      parser.current = undefined;
      setParsed(undefined);
    };
  }, [enabled]);

  useEffect(() => {
    parser.current?.update(source);
  }, [enabled, source]);

  // Never project a previous document after a replacement or a settled turn.
  return enabled && parsed && source.startsWith(parsed.source) ? parsed : undefined;
}
