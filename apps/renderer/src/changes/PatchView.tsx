import { useMemo } from "react";
import styles from "./ChangesPanel.module.css";

const MAX_RENDERED_PATCH_LINES = 600;

export type PatchLineKind = "meta" | "added" | "removed" | "context";

export interface RenderedPatch {
  lines: Array<{ content: string; kind: PatchLineKind }>;
  omittedLines: number;
}

export function PatchView({
  ariaLabel = "Unified Diff",
  patch,
  sourceTruncated
}: {
  ariaLabel?: string;
  patch: string;
  sourceTruncated: boolean;
}) {
  const rendered = useMemo(() => projectPatchLines(patch), [patch]);
  return (
    <pre aria-label={ariaLabel} className={styles.patch}>
      {rendered.lines.map((line, index) => (
        <span className={styles[patchLineClass(line.kind)]} key={`${index}:${line.content}`}>{line.content || " "}</span>
      ))}
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
  return {
    lines: visibleLines.map((content) => ({ content, kind: classifyPatchLine(content) })),
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

function patchLineClass(kind: PatchLineKind): "patchMeta" | "added" | "removed" | "context" {
  if (kind === "meta") return "patchMeta";
  return kind;
}
