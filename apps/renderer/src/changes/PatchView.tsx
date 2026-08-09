import type { ChangeReviewAnchor, ChangeReviewPatchSection } from "@pi67/domain";
import { useMemo } from "react";
import styles from "./ChangesPanel.module.css";

const MAX_RENDERED_PATCH_LINES = 600;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

export type PatchLineKind = "meta" | "added" | "removed" | "context";

interface RenderedPatchLine {
  content: string;
  kind: PatchLineKind;
  oldLine?: number;
  newLine?: number;
  anchor?: ChangeReviewAnchor;
}

export interface RenderedPatch {
  lines: RenderedPatchLine[];
  omittedLines: number;
}

export function PatchView({
  ariaLabel = "Unified Diff",
  patch,
  rendered: suppliedRendered,
  reviewEnabled = false,
  selectedAnchor,
  sourceTruncated,
  onAnchorSelect
}: {
  ariaLabel?: string;
  patch: string;
  rendered?: RenderedPatch;
  reviewEnabled?: boolean;
  selectedAnchor?: ChangeReviewAnchor;
  sourceTruncated: boolean;
  onAnchorSelect?: (anchor: ChangeReviewAnchor) => void;
}) {
  const projected = useMemo(() => projectPatchLines(patch), [patch]);
  const rendered = suppliedRendered ?? projected;
  return (
    <pre aria-label={ariaLabel} className={styles.patch}>
      {rendered.lines.map((line, index) => {
        const lineClass = `${styles.patchLine} ${styles[patchLineClass(line.kind)]}`;
        const key = `${index}:${line.content}`;
        const content = <>
          <span aria-hidden="true" className={styles.patchLineNumber}>{line.oldLine ?? ""}</span>
          <span aria-hidden="true" className={styles.patchLineNumber}>{line.newLine ?? ""}</span>
          <span className={styles.patchLineContent}>{line.content || " "}</span>
        </>;
        if (!reviewEnabled || !line.anchor || !onAnchorSelect) {
          return <span className={lineClass} key={key}>{content}</span>;
        }
        const selected = anchorsEqual(selectedAnchor, line.anchor);
        return (
          <button
            aria-label={`批注${patchSectionLabel(line.anchor.section)}${line.anchor.side === "new" ? "新" : "旧"}第 ${line.anchor.startLine} 行`}
            aria-pressed={selected}
            className={`${lineClass} ${styles.reviewablePatchLine}`}
            key={key}
            onClick={() => onAnchorSelect(line.anchor!)}
            type="button"
          >{content}</button>
        );
      })}
      {sourceTruncated || rendered.omittedLines > 0 ? (
        <span className={styles.patchNotice}>
          {sourceTruncated ? "Host 已截断 Patch。" : ""}
          {sourceTruncated && rendered.omittedLines > 0 ? " " : ""}
          {rendered.omittedLines > 0 ? `界面另省略 ${rendered.omittedLines} 行以保持流畅。` : ""}
        </span>
      ) : null}
    </pre>
  );
}

export function projectPatchLines(patch: string, limit = MAX_RENDERED_PATCH_LINES): RenderedPatch {
  const allLines = patch.split(/\r?\n/u);
  const visibleLines = allLines.slice(0, Math.max(0, limit));
  let section: ChangeReviewPatchSection = "session";
  let oldLine: number | undefined;
  let newLine: number | undefined;
  const lines = visibleLines.map((content): RenderedPatchLine => {
    if (content === "# STAGED") section = "staged";
    if (content === "# UNSTAGED") section = "unstaged";
    const hunk = HUNK_HEADER.exec(content);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { content, kind: "meta" };
    }
    const kind = classifyPatchLine(content);
    if (kind === "meta" || oldLine === undefined || newLine === undefined) return { content, kind };
    if (kind === "added") {
      const line = newLine;
      newLine += 1;
      const anchor = reviewAnchor(section, "new", line);
      return {
        content,
        kind,
        newLine: line,
        ...(anchor ? { anchor } : {})
      };
    }
    if (kind === "removed") {
      const line = oldLine;
      oldLine += 1;
      const anchor = reviewAnchor(section, "old", line);
      return {
        content,
        kind,
        oldLine: line,
        ...(anchor ? { anchor } : {})
      };
    }
    if (content.startsWith(" ")) {
      const previous = oldLine;
      const next = newLine;
      oldLine += 1;
      newLine += 1;
      const anchor = reviewAnchor(section, "new", next);
      return {
        content,
        kind,
        oldLine: previous,
        newLine: next,
        ...(anchor ? { anchor } : {})
      };
    }
    return { content, kind };
  });
  return {
    lines,
    omittedLines: Math.max(0, allLines.length - visibleLines.length)
  };
}

export function classifyPatchLine(line: string): PatchLineKind {
  if (
    line.startsWith("@@ ")
    || line.startsWith("diff --git ")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
    || line.startsWith("new file mode ")
    || line.startsWith("deleted file mode ")
    || line.startsWith("similarity index ")
    || line.startsWith("rename from ")
    || line.startsWith("rename to ")
    || line.startsWith("\\ No newline at end of file")
    || line === "# STAGED"
    || line === "# UNSTAGED"
  ) return "meta";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

function anchorsEqual(
  left: ChangeReviewAnchor | undefined,
  right: ChangeReviewAnchor | undefined
): boolean {
  return left !== undefined
    && right !== undefined
    && left.section === right.section
    && left.side === right.side
    && left.startLine === right.startLine
    && left.endLine === right.endLine;
}

function reviewAnchor(
  section: ChangeReviewPatchSection,
  side: "old" | "new",
  line: number
): ChangeReviewAnchor | undefined {
  return line < 1 ? undefined : { section, side, startLine: line, endLine: line };
}

function patchLineClass(kind: PatchLineKind): "patchMeta" | "added" | "removed" | "context" {
  if (kind === "meta") return "patchMeta";
  return kind;
}

function patchSectionLabel(section: ChangeReviewPatchSection): string {
  if (section === "staged") return "已暂存 Diff ";
  if (section === "unstaged") return "未暂存 Diff ";
  return "会话 Diff ";
}
