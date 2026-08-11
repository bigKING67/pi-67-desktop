import type { OperationView } from "@pi67/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  resolveProcessGroupOutcome,
  TranscriptProcessGroup
} from "./TranscriptProcessGroup.js";
import type { TranscriptRow } from "./transcript-rows.js";

describe("TranscriptProcessGroup outcome", () => {
  it("renders recovered Tool failures as a folded amber completion warning", () => {
    const row = processRow({
      outcome: "completed-with-warnings",
      toolCount: 7,
      unsuccessfulToolCount: 2,
      hasFinalAnswer: true
    });
    const html = renderToStaticMarkup(createElement(TranscriptProcessGroup, { row }));

    expect(html).toContain('data-process-outcome="completed-with-warnings"');
    expect(html).toContain("执行完成");
    expect(html).toContain("7 次工具调用 · 2 个步骤未成功");
    expect(html).not.toMatch(/<details[^>]* open=""/u);
  });

  it("uses red and auto-expansion only when the Operation itself failed", () => {
    const row = processRow({ outcome: "incomplete", hasFinalAnswer: false });
    const html = renderToStaticMarkup(createElement(TranscriptProcessGroup, {
      operation: operation("failed"),
      row
    }));

    expect(html).toContain('data-process-outcome="failed"');
    expect(html).toContain('data-process-failed="true"');
    expect(html).toContain("执行失败");
    expect(html).toMatch(/<details[^>]* open=""/u);
  });

  it.each([
    ["cancelled", "cancelled"],
    ["lost", "lost"],
    ["completed", "incomplete"]
  ] as const)("keeps Operation %s distinct when no final answer was projected", (lifecycle, expected) => {
    const row = processRow({ outcome: "incomplete", hasFinalAnswer: false });
    expect(resolveProcessGroupOutcome(row, operation(lifecycle), false, 0)).toBe(expected);
  });
});

function processRow(
  overrides: Partial<Extract<TranscriptRow, { kind: "process-group" }>> = {}
): Extract<TranscriptRow, { kind: "process-group" }> {
  return {
    kind: "process-group",
    key: "process-1",
    items: [],
    stepCount: 1,
    toolCount: 1,
    unsuccessfulToolCount: 0,
    outcome: "completed",
    hasFinalAnswer: true,
    ...overrides
  };
}

function operation(lifecycle: OperationView["lifecycle"]): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle,
    cancellable: false,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 1,
    startedAt: 1
  };
}
