const contracts = {
  "new-money.team-head.v1": { phases: ["authorization", "head-probe", "validation"],
    outcomes: ["completed", "authorization-failed", "head-probe-failed", "validation-failed", "revision-changed", "timeout", "cancelled"] },
  "new-money.team-read.v1": { phases: ["reader-admission", "local-body-read", "current-check"],
    outcomes: ["completed", "failed", "cancelled", "snapshot-changed"] }
};
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const duration = value => Number.isSafeInteger(value) && value >= 0;
function project(value) {
  if (!exactKeys(value, ["schema", "outcome", "durationMs", "stages"]) || !Object.hasOwn(contracts, value.schema)) return undefined;
  const contract = contracts[value.schema];
  if (!contract.outcomes.includes(value.outcome) || !duration(value.durationMs) || !Array.isArray(value.stages)
    || value.stages.length < 1 || value.stages.length > 3
    || (value.outcome === "completed" && value.stages.length !== 3)
    || !value.stages.every((item, index) => exactKeys(item, ["stage", "durationMs"])
      && item.stage === contract.phases[index] && duration(item.durationMs))) return undefined;
  return { schema: value.schema, outcome: value.outcome, durationMs: value.durationMs,
    stages: value.stages.map(item => ({ stage: item.stage, durationMs: item.durationMs })) };
}
export const projectTeamPhaseDiagnostics = values => Array.isArray(values) ? values.slice(-128).map(project).filter(Boolean) : [];

/** Separate bounded line decoders per process stream. No raw output is retained. */
export function createTeamPhaseCapture() {
  const streams = { stdout: { line: "", dropping: false }, stderr: { line: "", dropping: false } }, records = [];
  return {
    write(channel, chunk) {
      if (!Object.hasOwn(streams, channel)) return;
      const stream = streams[channel];
      for (const character of String(chunk)) {
        if (character === "\n") {
          const match = !stream.dropping && /^(?:\[agent-host\] )?\[team-(head|read)\] (\{.*\})\r?$/u.exec(stream.line);
          if (match) {
            try {
              const record = project(JSON.parse(match[2]));
              if (record && record.schema === `new-money.team-${match[1]}.v1`) {
                records.push(record); if (records.length > 128) records.shift();
              }
            } catch { /* Ignore malformed output, never retain raw text/errors. */ }
          }
          stream.line = ""; stream.dropping = false;
        } else if (!stream.dropping) {
          if (stream.line.length >= 2_048) { stream.line = ""; stream.dropping = true; }
          else stream.line += character;
        }
      }
    },
    records: () => projectTeamPhaseDiagnostics(records)
  };
}
