import { MAX_PROJECTED_TEXT_BYTES } from "@pi67/domain";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { MarkdownParseResponse } from "./streaming-markdown-parser.js";

const parser = unified().use(remarkParse).use(remarkGfm).freeze();

self.onmessage = ({ data }: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = data;
  try {
    if (!Number.isSafeInteger(id) || typeof source !== "string"
      || new TextEncoder().encode(source).byteLength > MAX_PROJECTED_TEXT_BYTES) {
      throw new Error("Invalid Markdown parse request.");
    }
    self.postMessage({ id, ok: true, tree: parser.parse(source) } satisfies MarkdownParseResponse);
  } catch {
    self.postMessage({ id, ok: false } satisfies MarkdownParseResponse);
  }
};
