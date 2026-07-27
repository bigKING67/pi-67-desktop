import type { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  MAX_TREE_JSON_BYTES,
  MAX_TREE_NODES,
  type SessionTreeNodeView,
  type SessionTreeProjection
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

const MAX_TREE_ID_BYTES = 512;
const MAX_TREE_TYPE_BYTES = 64;
const MAX_TREE_LABEL_BYTES = 256;
const MAX_TREE_PREVIEW_BYTES = 512;
const MAX_PREVIEW_PARTS = 16;

type TreeSource = Pick<SessionManager, "getLeafId" | "getTree">;
type SourceTreeNode = ReturnType<SessionManager["getTree"]>[number];

export function projectSessionTree(source: TreeSource): SessionTreeProjection {
  const roots = source.getTree();
  const leafId = source.getLeafId();
  const summary = summarizeTree(roots, leafId);
  if (summary.total === 0) return { nodes: [], truncated: false, total: 0 };

  const window = projectionWindow(summary.total, summary.activeIndex);
  const candidates: SessionTreeNodeView[] = [];
  visitTree(roots, (node, depth, index) => {
    if (index >= window.start && index < window.end) {
      candidates.push(projectTreeNode(node, depth, leafId));
    }
  });

  const nodes = fitTreeToByteBudget(candidates, summary.total);
  return {
    nodes,
    truncated: nodes.length < summary.total,
    total: summary.total
  };
}

function summarizeTree(roots: SourceTreeNode[], leafId: string | null): { total: number; activeIndex: number } {
  let total = 0;
  let activeIndex = -1;
  visitTree(roots, (node, _depth, index) => {
    if (node.entry.id === leafId) activeIndex = index;
    total += 1;
  });
  return { total, activeIndex };
}

function projectionWindow(total: number, activeIndex: number): { start: number; end: number } {
  if (total <= MAX_TREE_NODES) return { start: 0, end: total };
  if (activeIndex < 0) return { start: total - MAX_TREE_NODES, end: total };

  const preferredBefore = Math.floor((MAX_TREE_NODES - 1) * 0.75);
  const start = Math.min(total - MAX_TREE_NODES, Math.max(0, activeIndex - preferredBefore));
  return { start, end: start + MAX_TREE_NODES };
}

function visitTree(
  roots: SourceTreeNode[],
  visitor: (node: SourceTreeNode, depth: number, index: number) => void
): void {
  const stack: Array<{ node: SourceTreeNode; depth: number }> = [];
  const visited = new WeakSet<object>();
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index];
    if (root) stack.push({ node: root, depth: 0 });
  }

  let index = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || visited.has(entry.node)) continue;
    visited.add(entry.node);
    visitor(entry.node, entry.depth, index);
    index += 1;
    for (let childIndex = entry.node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = entry.node.children[childIndex];
      if (child) stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
}

function projectTreeNode(node: SourceTreeNode, depth: number, leafId: string | null): SessionTreeNodeView {
  const entry = node.entry as unknown as Record<string, unknown>;
  const rawId = typeof entry.id === "string" ? entry.id : "unknown";
  return {
    id: boundedUtf8(rawId, MAX_TREE_ID_BYTES),
    parentId: typeof entry.parentId === "string" ? boundedUtf8(entry.parentId, MAX_TREE_ID_BYTES) : null,
    type: boundedUtf8(typeof entry.type === "string" ? entry.type : "entry", MAX_TREE_TYPE_BYTES),
    ...(node.label ? {
      label: boundedUtf8(
        sanitizeRuntimeText(boundedUtf8(node.label, MAX_TREE_LABEL_BYTES * 2)),
        MAX_TREE_LABEL_BYTES
      )
    } : {}),
    preview: boundedUtf8(sanitizeRuntimeText(sessionTreePreview(entry)), MAX_TREE_PREVIEW_BYTES),
    active: rawId === leafId,
    depth
  };
}

function fitTreeToByteBudget(candidates: SessionTreeNodeView[], total: number): SessionTreeNodeView[] {
  if (candidates.length === 0) return candidates;
  const nodeBytes = candidates.map(projectedJsonBytes);
  let bytes = projectedJsonBytes({ nodes: [], truncated: true, total });
  for (const value of nodeBytes) bytes += value + 1;

  let start = 0;
  let end = candidates.length;
  const activeIndex = candidates.findIndex((node) => node.active);
  while (bytes > MAX_TREE_JSON_BYTES && end - start > 1) {
    const leftDistance = activeIndex < 0 ? Number.POSITIVE_INFINITY : activeIndex - start;
    const rightDistance = activeIndex < 0 ? 0 : end - 1 - activeIndex;
    if (leftDistance >= rightDistance && leftDistance > 0) {
      bytes -= (nodeBytes[start] ?? 0) + 1;
      start += 1;
    } else if (rightDistance > 0) {
      end -= 1;
      bytes -= (nodeBytes[end] ?? 0) + 1;
    } else {
      break;
    }
  }
  return candidates.slice(start, end);
}

function projectedJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function sessionTreePreview(entry: Record<string, unknown>): string {
  const message = typeof entry.message === "object" && entry.message !== null
    ? entry.message as Record<string, unknown>
    : undefined;
  const content = message?.content ?? entry.summary ?? entry.name ?? entry.type;
  if (typeof content === "string") return content.slice(0, MAX_TREE_PREVIEW_BYTES * 2);
  if (!Array.isArray(content)) return "Session entry";

  const text: string[] = [];
  for (let index = 0; index < Math.min(content.length, MAX_PREVIEW_PARTS); index += 1) {
    const part = content[index];
    if (typeof part === "string") text.push(part.slice(0, MAX_TREE_PREVIEW_BYTES));
    else if (typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).text === "string") {
      text.push(((part as Record<string, unknown>).text as string).slice(0, MAX_TREE_PREVIEW_BYTES));
    }
    if (text.join(" ").length >= MAX_TREE_PREVIEW_BYTES) break;
  }
  return text.join(" ").trim() || "Session entry";
}

function boundedUtf8(value: string, maxBytes: number): string {
  if (value.length <= maxBytes && Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bounded = Buffer.from(value.slice(0, maxBytes), "utf8").subarray(0, maxBytes).toString("utf8");
  while (bounded.endsWith("\uFFFD")) bounded = bounded.slice(0, -1);
  return bounded;
}
