import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HighlightToken } from "./code-highlighter.js";

export function MarkdownView({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <button className="markdown-link" type="button" onClick={() => {
              const target = safeExternalHref(href);
              if (target) void window.pi67.system.requestOpenExternal(target);
            }}>
              {linkChildren}
            </button>
          ),
          code: ({ className, children: codeChildren }) => {
            const code = codeText(codeChildren).replace(/\n$/, "");
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
            return className
              ? <CodeBlock code={code} {...(language === undefined ? {} : { language })} />
              : <code>{codeChildren}</code>;
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [highlight, setHighlight] = useState<HighlightResult>({ state: "loading", lines: [] });
  useEffect(() => {
    let current = true;
    setHighlight({ state: "loading", lines: [] });
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    void import("./code-highlighter.js").then(async ({ highlightCode }) => {
      const result = await highlightCode(code, language, dark);
      if (!current) return;
      setHighlight({ state: "ready", lines: result });
    }).catch((error: unknown) => {
      if (!current) return;
      setHighlight({ state: "fallback", lines: [], error: highlightError(error) });
    });
    return () => {
      current = false;
    };
  }, [code, language]);

  return (
    <div
      className="code-block"
      data-highlight-state={highlight.state}
      aria-busy={highlight.state === "loading"}
      {...(highlight.error === undefined ? {} : { "data-highlight-error": highlight.error })}
      {...(highlight.state === "ready" ? { "data-highlighted-line-count": highlight.lines.length } : {})}
    >
      <div className="code-header"><span>{language ?? "text"}</span><button type="button" onClick={() => void navigator.clipboard.writeText(code)}>复制</button></div>
      {highlight.lines.length > VIRTUAL_CODE_THRESHOLD
        ? <VirtualCodeLines lines={highlight.lines} {...(language === undefined ? {} : { language })} />
        : (
            <pre>
              {highlight.lines.length > 0
                ? highlight.lines.map((line, lineIndex) => renderCodeLine(line, lineIndex, false))
                : <code>{code}</code>}
            </pre>
          )}
    </div>
  );
}

const VIRTUAL_CODE_THRESHOLD = 200;
const VIRTUAL_CODE_LINE_HEIGHT = 19.2;
const VIRTUAL_CODE_VIEWPORT_HEIGHT = 520;
const VIRTUAL_CODE_OVERSCAN = 16;

function VirtualCodeLines({ lines, language }: { lines: HighlightToken[][]; language?: string }) {
  const [start, setStart] = useState(0);
  const animationFrame = useRef<number | undefined>(undefined);
  const visibleLineCount = Math.ceil(VIRTUAL_CODE_VIEWPORT_HEIGHT / VIRTUAL_CODE_LINE_HEIGHT)
    + (VIRTUAL_CODE_OVERSCAN * 2);
  const end = Math.min(lines.length, start + visibleLineCount);
  const longestLine = useMemo(() => lines.reduce((longest, line) => (
    Math.max(longest, line.reduce((length, token) => length + token.content.length, 0))
  ), 0), [lines]);

  useEffect(() => () => {
    if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
  }, []);

  return (
    <pre
      className="code-virtualized"
      aria-label={`${language ?? "text"} code, ${lines.length} lines`}
      onScroll={(event) => {
        if (animationFrame.current !== undefined) return;
        const scrollTop = event.currentTarget.scrollTop;
        animationFrame.current = requestAnimationFrame(() => {
          const nextStart = Math.max(0, Math.floor(scrollTop / VIRTUAL_CODE_LINE_HEIGHT) - VIRTUAL_CODE_OVERSCAN);
          setStart(Math.min(nextStart, Math.max(0, lines.length - visibleLineCount)));
          animationFrame.current = undefined;
        });
      }}
      tabIndex={0}
    >
      <span
        className="code-virtual-space"
        style={{ height: `${lines.length * VIRTUAL_CODE_LINE_HEIGHT}px`, minWidth: `${longestLine}ch` }}
      >
        <span
          className="code-virtual-window"
          style={{ transform: `translateY(${start * VIRTUAL_CODE_LINE_HEIGHT}px)` }}
        >
          {lines.slice(start, end).map((line, index) => renderCodeLine(line, start + index, true))}
        </span>
      </span>
    </pre>
  );
}

function renderCodeLine(line: HighlightToken[], lineIndex: number, virtual: boolean): ReactNode {
  return (
    <span className={`code-line${virtual ? " is-virtual" : ""}`} key={lineIndex}>
      {line.map((token, tokenIndex) => (
        <span key={tokenIndex} style={token.color ? { color: token.color } : undefined}>{token.content}</span>
      ))}
      {virtual ? null : "\n"}
    </span>
  );
}

interface HighlightResult {
  state: "loading" | "ready" | "fallback";
  lines: HighlightToken[][];
  error?: string;
}

function highlightError(error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return detail.slice(0, 512);
}

function safeExternalHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function codeText(value: ReactNode): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return `${value}`;
  if (Array.isArray(value)) return value.map(codeText).join("");
  return "";
}
