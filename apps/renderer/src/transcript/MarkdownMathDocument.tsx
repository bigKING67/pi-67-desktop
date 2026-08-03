import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { preserveMarkdownUrlForPolicy } from "./markdown-url.js";

export function MarkdownMathDocument({
  children,
  components
}: {
  children: string;
  components: Components;
}) {
  return (
    <ReactMarkdown
      components={components}
      rehypePlugins={[[rehypeKatex, {
        maxExpand: 1_000,
        maxSize: 10,
        output: "htmlAndMathml",
        strict: "ignore",
        trust: false
      }], annotateDisplayMath]}
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      urlTransform={preserveMarkdownUrlForPolicy}
    >
      {children}
    </ReactMarkdown>
  );
}

interface HastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function annotateDisplayMath() {
  return (tree: HastNode): void => {
    visit(tree, (node) => {
      if (node.tagName !== "span" || !hasClass(node, "katex-display")) return;
      node.properties = {
        ...node.properties,
        "aria-label": "公式，可横向滚动",
        "data-math-display": "true",
        role: "region",
        tabIndex: 0
      };
    });
  };
}

function visit(node: HastNode, callback: (candidate: HastNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

function hasClass(node: HastNode, className: string): boolean {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.includes(className) : value === className;
}
