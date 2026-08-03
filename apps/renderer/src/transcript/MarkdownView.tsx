import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import type { HighlightToken } from "./code-highlighter.js";
import { classifyMarkdownLink } from "./markdown-link.js";
import { normalizeMarkdownMath } from "./markdown-math.js";
import { preserveMarkdownUrlForPolicy } from "./markdown-url.js";
import styles from "./MarkdownView.module.css";

interface MarkdownViewProps {
  children: string;
  mode?: "settled" | "streaming";
  onOpenWorkspacePath?: (target: { relativePath: string; fragment?: string }) => Promise<void>;
}

const MarkdownMathDocument = lazy(() => import("./MarkdownMathDocument.js").then((module) => ({
  default: module.MarkdownMathDocument
})));

export function MarkdownView({ children, mode = "settled", onOpenWorkspacePath }: MarkdownViewProps) {
  const streaming = mode === "streaming";
  const normalized = useMemo(() => normalizeMarkdownMath(children), [children]);
  const components = useMemo<Components>(() => ({
    a: ({ href, children: linkChildren }) => {
      const target = classifyMarkdownLink(href);
      if (target.kind === "external") {
        return (
          <a
            className={styles.link}
            data-markdown-link="external"
            href={target.href}
            rel="noreferrer noopener"
            onClick={(event) => {
              event.preventDefault();
              void window.pi67.system.requestOpenExternal(target.href);
            }}
          >
            {linkChildren}
          </a>
        );
      }
      if (target.kind === "workspace" && onOpenWorkspacePath) {
        return (
          <a
            className={styles.link}
            data-markdown-link="workspace"
            href={href}
            onClick={(event) => {
              event.preventDefault();
              void onOpenWorkspacePath(target);
            }}
          >
            {linkChildren}
          </a>
        );
      }
      return <span className={`${styles.link} ${styles.disabled}`}>{linkChildren}</span>;
    },
    code: ({ className, children: codeChildren }) => {
      const code = codeText(codeChildren).replace(/\n$/, "");
      const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
      return className
        ? streaming
          ? <StreamingCodeBlock code={code} {...(language === undefined ? {} : { language })} />
          : <CodeBlock code={code} {...(language === undefined ? {} : { language })} />
        : <code>{codeChildren}</code>;
    },
    img: ({ alt, src }) => (
      <BlockedMarkdownImage
        {...(alt === undefined ? {} : { alt })}
        {...(src === undefined ? {} : { src })}
      />
    ),
    table: ({ children: tableChildren }) => (
      <div
        aria-label="表格，可横向滚动"
        className={styles.tableScroll}
        data-markdown-table-scroll="true"
        tabIndex={0}
      >
        <table>{tableChildren}</table>
      </div>
    )
  }), [onOpenWorkspacePath, streaming]);
  const document = normalized.hasMath ? (
    <Suspense fallback={<MarkdownDocument components={components}>{normalized.source}</MarkdownDocument>}>
      <MarkdownMathDocument components={components}>{normalized.source}</MarkdownMathDocument>
    </Suspense>
  ) : <MarkdownDocument components={components}>{normalized.source}</MarkdownDocument>;

  return (
    <div className={styles.body} data-markdown-math={normalized.hasMath || undefined} data-markdown-mode={mode}>
      {document}
    </div>
  );
}

function MarkdownDocument({ children, components }: { children: string; components: Components }) {
  return (
    <ReactMarkdown
      components={components}
      remarkPlugins={[remarkGfm]}
      urlTransform={preserveMarkdownUrlForPolicy}
    >
      {children}
    </ReactMarkdown>
  );
}

function BlockedMarkdownImage({ alt, src }: { alt?: string; src?: string }) {
  const target = classifyMarkdownLink(src);
  const sourceLabel = markdownImageSourceLabel(target, src);
  return (
    <span className={styles.blockedImage}>
      <span className={styles.blockedImageDescription} role="img" aria-label={alt || "Markdown 图片未加载"}>
        <span>{alt ? `图片：${alt}` : "Markdown 图片未加载"}</span>
        {sourceLabel ? <small>{sourceLabel}</small> : null}
      </span>
      {target.kind === "external" ? (
        <button type="button" onClick={() => void window.pi67.system.requestOpenExternal(target.href)}>
          打开图片链接
        </button>
      ) : null}
    </span>
  );
}

function markdownImageSourceLabel(target: ReturnType<typeof classifyMarkdownLink>, source: string | undefined): string | undefined {
  if (target.kind === "external") return target.href;
  if (target.kind === "workspace") return `工作区图片路径：${target.relativePath}`;
  if (source?.startsWith("data:")) return "内嵌图片未加载";
  return source ? "图片来源不受支持" : undefined;
}

function StreamingCodeBlock({ code, language }: { code: string; language?: string }) {
  const viewport = useCodeScrollability(code);
  return (
    <div className={styles.codeBlock} data-highlight-state="streaming" data-testid="code-block">
      <div className={styles.codeHeader}><span>{language ?? "text"}</span><CodeCopyButton code={code} /></div>
      <pre
        ref={viewport.ref}
        aria-label={viewport.scrollable ? `${language ?? "text"} 代码，可滚动` : undefined}
        data-code-scrollable={viewport.scrollable || undefined}
        tabIndex={viewport.scrollable ? 0 : undefined}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [highlight, setHighlight] = useState<HighlightResult>({ state: "loading", lines: [] });
  const viewport = useCodeScrollability(code);
  useEffect(() => {
    let current = true;
    setHighlight({ state: "loading", lines: [] });
    void import("./code-highlighter.js").then(async ({ highlightCode }) => {
      const result = await highlightCode(code, language);
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
      className={styles.codeBlock}
      data-highlight-state={highlight.state}
      data-testid="code-block"
      aria-busy={highlight.state === "loading"}
      {...(highlight.error === undefined ? {} : { "data-highlight-error": highlight.error })}
      {...(highlight.state === "ready" ? { "data-highlighted-line-count": highlight.lines.length } : {})}
    >
      <div className={styles.codeHeader}><span>{language ?? "text"}</span><CodeCopyButton code={code} /></div>
      {highlight.lines.length > VIRTUAL_CODE_THRESHOLD
        ? <VirtualCodeLines lines={highlight.lines} {...(language === undefined ? {} : { language })} />
        : (
            <pre
              ref={viewport.ref}
              aria-label={viewport.scrollable ? `${language ?? "text"} 代码，可滚动` : undefined}
              data-code-scrollable={viewport.scrollable || undefined}
              tabIndex={viewport.scrollable ? 0 : undefined}
            >
              {highlight.lines.length > 0
                ? highlight.lines.map((line, lineIndex) => renderCodeLine(line, lineIndex, false))
                : <code>{code}</code>}
            </pre>
          )}
    </div>
  );
}

function CodeCopyButton({ code }: { code: string }) {
  const { copyState, copyText } = useCopyFeedback({ failureTitle: "代码复制失败" });
  const label = copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制";
  return (
    <button aria-live="polite" data-copy-state={copyState} type="button" onClick={() => void copyText(code)}>
      {label}
    </button>
  );
}

function useCodeScrollability(code: string) {
  const ref = useRef<HTMLPreElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setScrollable(
      element.scrollWidth > element.clientWidth + 1
      || element.scrollHeight > element.clientHeight + 1
    );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const content = element.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [code]);

  return { ref, scrollable } as const;
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
      className={styles.virtualized}
      aria-label={`${language ?? "text"} 代码，共 ${lines.length} 行，可滚动`}
      data-code-scrollable="true"
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
        className={styles.virtualSpace}
        style={{ height: `${lines.length * VIRTUAL_CODE_LINE_HEIGHT}px`, minWidth: `${longestLine}ch` }}
      >
        <span
          className={styles.virtualWindow}
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
    <span
      className={`${styles.codeLine} ${virtual ? styles.virtualLine : ""}`}
      data-code-line={lineIndex}
      data-testid="code-line"
      key={lineIndex}
    >
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

function codeText(value: ReactNode): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return `${value}`;
  if (Array.isArray(value)) return value.map(codeText).join("");
  return "";
}
