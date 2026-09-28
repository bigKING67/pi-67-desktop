export function extractWorkflowRunBodies(source) {
  const lines = source.split(/\r?\n/u);
  const bodies = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/u.exec(lines[index]);
    if (!match) continue;
    const run = readRunBody(lines, index, lines.length);
    bodies.push(run.body);
    index = run.endIndex;
  }
  return bodies;
}

// Resolves each step's effective shell like GitHub Actions: step `shell:`, then job
// `defaults.run.shell`, then workflow `defaults.run.shell`, then the runner default
// (pwsh on Windows runners, bash elsewhere). Unnamed steps are included.
export function extractWorkflowShellRunBodies(source, expectedShell) {
  const lines = source.split(/\r?\n/u);
  const workflowDefault = defaultRunShell(lines, 0, lines.length, 0);
  const scripts = [];
  for (const job of workflowJobs(lines)) {
    const runsOn = valueOf(lines, job.start, job.end, job.indentation + 2, "runs-on") ?? "";
    const jobDefault = defaultRunShell(lines, job.start, job.end, job.indentation + 2) ?? workflowDefault;
    const runnerDefault = /windows/iu.test(runsOn) ? "pwsh" : "bash";
    for (const step of workflowSteps(lines, job)) {
      const keyIndentation = step.indentation + 2;
      const shell = valueOf(lines, step.start, step.end, keyIndentation, "shell", true) ?? jobDefault ?? runnerDefault;
      if (shell !== expectedShell) continue;
      let runIndex = -1;
      for (let cursor = step.start; cursor < step.end; cursor += 1) {
        if (keyAt(lines[cursor], keyIndentation, "run", cursor === step.start)) { runIndex = cursor; break; }
      }
      if (runIndex < 0) continue;
      const name = valueOf(lines, step.start, step.end, keyIndentation, "name", true) ?? `unnamed step at line ${step.start + 1}`;
      const run = readRunBody(lines, runIndex, step.end);
      scripts.push({ name, body: dedent(run.body) });
    }
  }
  return scripts;
}

function workflowJobs(lines) {
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (jobsIndex < 0) return [];
  const jobs = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && leadingWhitespace(line) === 0) break;
    if (!/^\s{2}[\w-]+:\s*$/u.test(line)) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].trim() && leadingWhitespace(lines[cursor]) <= 2) { end = cursor; break; }
    }
    jobs.push({ start: index + 1, end, indentation: 2 });
    index = end - 1;
  }
  return jobs;
}

function workflowSteps(lines, job) {
  const stepsIndex = lines.slice(job.start, job.end).findIndex((line) => (
    leadingWhitespace(line) === job.indentation + 2 && /^\s*steps:\s*$/u.test(line)
  ));
  if (stepsIndex < 0) return [];
  const steps = [];
  let itemIndentation;
  for (let index = job.start + stepsIndex + 1; index < job.end; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indentation = leadingWhitespace(line);
    if (indentation <= job.indentation + 2) break;
    if (!/^\s*-\s+/u.test(line)) continue;
    itemIndentation ??= indentation;
    if (indentation !== itemIndentation) continue;
    const last = steps.at(-1);
    if (last) last.end = index;
    steps.push({ start: index, end: job.end, indentation });
  }
  return steps;
}

function defaultRunShell(lines, start, end, indentation) {
  for (let index = start; index < end; index += 1) {
    if (leadingWhitespace(lines[index]) !== indentation || !/^\s*defaults:\s*$/u.test(lines[index])) continue;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (lines[cursor].trim() && leadingWhitespace(lines[cursor]) <= indentation) break;
      if (/^\s*run:\s*$/u.test(lines[cursor])) {
        return valueOf(lines, cursor + 1, end, leadingWhitespace(lines[cursor]) + 2, "shell");
      }
    }
  }
  return undefined;
}

// Reads `key: value` at an exact indentation; `firstMayBeItem` also accepts it on the step's `- ` line.
function valueOf(lines, start, end, indentation, key, firstMayBeItem = false) {
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (index > start && line.trim() && leadingWhitespace(line) < indentation) break;
    if (keyAt(line, indentation, key, firstMayBeItem && index === start)) {
      return /:\s*(.*)$/u.exec(line)?.[1]?.trim().replace(/^["']|["']$/gu, "") || undefined;
    }
  }
  return undefined;
}

function keyAt(line, indentation, key, asListItem) {
  const pattern = asListItem
    ? new RegExp(`^\\s{${indentation - 2}}-\\s+${key}:`, "u")
    : new RegExp(`^\\s{${indentation}}${key}:`, "u");
  return pattern.test(line);
}

function readRunBody(lines, runIndex, boundary) {
  // `- run:` starts an unnamed step; the prefix counts toward the key indentation.
  const match = /^(\s*(?:-\s+)?)run:\s*(.*)$/u.exec(lines[runIndex]);
  if (!match) throw new Error("Workflow run body is missing.");
  const indentation = match[1].length;
  const inline = match[2];
  if (inline !== "|" && inline !== ">") {
    return { body: inline, endIndex: runIndex };
  }
  const block = [];
  let endIndex = runIndex;
  for (let index = runIndex + 1; index < boundary; index += 1) {
    const line = lines[index];
    if (line.trim() && leadingWhitespace(line) <= indentation) break;
    block.push(line);
    endIndex = index;
  }
  return { body: block.join("\n"), endIndex };
}

function dedent(value) {
  const lines = value.split("\n");
  const indentation = lines
    .filter((line) => line.trim())
    .reduce((minimum, line) => Math.min(minimum, leadingWhitespace(line)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(indentation) || indentation === 0) return value;
  return lines.map((line) => line.slice(Math.min(indentation, leadingWhitespace(line)))).join("\n");
}

function leadingWhitespace(value) {
  return /^\s*/u.exec(value)?.[0].length ?? 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
