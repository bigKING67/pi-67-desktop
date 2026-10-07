import { workspaceExploration } from "../tool-cards/index.js";
import type { TranscriptProcessItem } from "./transcript-rows.js";

type ToolProcessItem = Extract<TranscriptProcessItem, { kind: "tool" }>;

export type ProcessRenderItem =
  | { kind: "item"; item: TranscriptProcessItem }
  | { kind: "exploration"; key: string; items: readonly ToolProcessItem[]; reads: number; searches: number };

/** A single read stays a normal step; grouping starts at two consecutive successful explorations. */
const MIN_EXPLORATION_RUN = 2;

/**
 * Disposable Renderer projection: once a process has settled, consecutive successful Workspace
 * reads and searches collapse into one expandable step. While running every call stays individual,
 * so visible steps never regroup or remount mid-Operation. No process item is ever dropped.
 */
export function groupExplorationRuns(
  items: readonly TranscriptProcessItem[],
  settled: boolean
): ProcessRenderItem[] {
  if (!settled) return items.map((item) => ({ kind: "item", item }));
  const result: ProcessRenderItem[] = [];
  let run: { item: ToolProcessItem; mode: "read" | "search"; target?: string }[] = [];
  const flush = () => {
    if (run.length >= MIN_EXPLORATION_RUN) {
      const reads = run.filter((entry) => entry.mode === "read");
      result.push({
        kind: "exploration",
        key: `exploration:${run[0]!.item.key}`,
        items: run.map((entry) => entry.item),
        // Repeated or paged reads of one path count once; reads without a known path count each.
        reads: new Set(reads.map((entry) => entry.target ?? `call:${entry.item.key}`)).size,
        searches: run.length - reads.length
      });
    } else {
      result.push(...run.map((entry) => ({ kind: "item" as const, item: entry.item })));
    }
    run = [];
  };
  for (const item of items) {
    const exploration = item.kind === "tool" ? successfulExploration(item) : undefined;
    if (exploration && item.kind === "tool") {
      run.push({ item, ...exploration });
      continue;
    }
    flush();
    result.push({ kind: "item", item });
  }
  flush();
  return result;
}

function successfulExploration(item: ToolProcessItem) {
  const execution = item.call.execution;
  const status = execution?.status ?? item.call.status;
  if (status !== "completed" || item.result?.error || execution?.nestedRecord?.complete === false) {
    return undefined;
  }
  // Classify the same input summary ToolCard presents.
  return workspaceExploration(execution?.inputSummary === undefined
    ? item.call
    : { ...item.call, summary: execution.inputSummary.text });
}
