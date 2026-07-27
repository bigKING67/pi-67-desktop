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

export function extractWorkflowShellRunBodies(source, expectedShell) {
  const lines = source.split(/\r?\n/u);
  const scripts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const step = /^(\s*)-\s+name:\s*(.+)$/u.exec(lines[index]);
    if (!step) continue;
    const stepIndentation = step[1].length;
    let stepEnd = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) continue;
      const indentation = leadingWhitespace(line);
      if (indentation < stepIndentation || (indentation === stepIndentation && /^\s*-\s+/u.test(line))) {
        stepEnd = cursor;
        break;
      }
    }
    const shellLine = lines.slice(index + 1, stepEnd).find((line) => (
      new RegExp(`^\\s*shell:\\s*${escapeRegExp(expectedShell)}\\s*$`, "u").test(line)
    ));
    if (!shellLine) {
      index = stepEnd - 1;
      continue;
    }
    let runIndex = -1;
    for (let cursor = index + 1; cursor < stepEnd; cursor += 1) {
      if (/^\s*run:\s*/u.test(lines[cursor])) {
        runIndex = cursor;
        break;
      }
    }
    if (runIndex < 0) throw new Error(`Workflow ${expectedShell} step has no run body: ${step[2].trim()}.`);
    const run = readRunBody(lines, runIndex, stepEnd);
    scripts.push({ name: step[2].trim(), body: dedent(run.body) });
    index = stepEnd - 1;
  }
  return scripts;
}

function readRunBody(lines, runIndex, boundary) {
  const match = /^(\s*)run:\s*(.*)$/u.exec(lines[runIndex]);
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
