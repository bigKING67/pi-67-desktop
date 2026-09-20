import { expect, it } from "vitest";
import { createTeamPhaseCapture, projectTeamPhaseDiagnostics } from "./packaged-team-phase-diagnostics.mjs";

const head = { schema: "new-money.team-head.v1", outcome: "timeout", durationMs: 8000,
  stages: [{ stage: "authorization", durationMs: 2500 }, { stage: "head-probe", durationMs: 5500 }] };
const read = { schema: "new-money.team-read.v1", outcome: "failed", durationMs: 8010,
  stages: [{ stage: "reader-admission", durationMs: 8010 }] };
const line = (record = head) => `[agent-host] [team-head] ${JSON.stringify(record)}\n`;
it("captures fragmented Host and Main output without joining independent streams", () => {
  const capture = createTeamPhaseCapture(), text = line();
  capture.write("stderr", Buffer.from(text.slice(0, 70)));
  capture.write("stdout", `[team-read] ${JSON.stringify(read)}\n`);
  expect(capture.records()).toEqual([read]);
  capture.write("stderr", text.slice(70)); expect(capture.records()).toEqual([read, head]);
  capture.records()[0].stages[0].durationMs = 1;
  expect(capture.records()).toEqual([read, head]);
});
it("discards oversized lines, unrelated errors and unfinished output, then recovers", () => {
  const capture = createTeamPhaseCapture();
  capture.write("stderr", "private secret ".repeat(1000));
  capture.write("stderr", line()); // Still the oversized line; must not salvage its suffix.
  capture.write("stderr", "raw private error\n{malformed}\n");
  expect(capture.records()).toEqual([]);
  capture.write("stderr", line()); capture.write("stdout", "private partial");
  expect(capture.records()).toEqual([head]);
});
it.each([
  { ...head, token: "private" }, { ...head, schema: "__proto__" },
  { ...head, outcome: "private" }, { ...head, durationMs: Infinity }, { ...head, durationMs: -1 },
  { ...head, stages: [] }, { ...head, stages: Array(4).fill(head.stages[0]) },
  { ...head, stages: [{ ...head.stages[0], body: "private" }] },
  { ...head, stages: [{ stage: "private", durationMs: 1 }] },
  { ...head, outcome: "completed" }, null, "private"
])("rejects malformed or expanded diagnostic shapes without retaining arbitrary fields", value => {
  expect(projectTeamPhaseDiagnostics([value])).toEqual([]);
  const capture = createTeamPhaseCapture(); capture.write("stderr", line(value));
  expect(capture.records()).toEqual([]);
});
it("rejects mismatched markers and bounds stored records to the last 128", () => {
  const capture = createTeamPhaseCapture(); capture.write("stdout", `[team-read] ${JSON.stringify(head)}\n`);
  expect(capture.records()).toEqual([]);
  for (let durationMs = 0; durationMs < 200; durationMs++) capture.write("stderr", line({ ...head, durationMs }));
  expect(capture.records()).toHaveLength(128); expect(capture.records()[0].durationMs).toBe(72);
  expect(projectTeamPhaseDiagnostics(Array(200).fill(head))).toHaveLength(128);
});
