export interface NormalizedMarkdownMath {
  source: string;
  hasMath: boolean;
}

interface MathNormalizationState {
  displayDollarOpen: boolean;
  inlineTicks: number;
  hasMath: boolean;
}

interface FenceState {
  marker: "`" | "~";
  length: number;
}

export function normalizeMarkdownMath(markdown: string): NormalizedMarkdownMath {
  const lines = markdown.split("\n");
  const state: MathNormalizationState = { displayDollarOpen: false, inlineTicks: 0, hasMath: false };
  let fence: FenceState | undefined;

  const normalized = lines.map((line) => {
    const fenceRun = markdownFence(line);
    if (fence) {
      if (fenceRun && fenceRun.marker === fence.marker && fenceRun.length >= fence.length && fenceRun.closing) {
        fence = undefined;
      }
      return line;
    }

    if (state.inlineTicks === 0 && fenceRun) {
      fence = { marker: fenceRun.marker, length: fenceRun.length };
      if (fenceRun.info === "math") state.hasMath = true;
      return line;
    }

    const standaloneDisplay = /^(\s*)\\(\[|\])\s*$/u.exec(line);
    if (state.inlineTicks === 0 && standaloneDisplay) {
      if (standaloneDisplay[2] === "[") state.displayDollarOpen = true;
      else if (state.displayDollarOpen) {
        state.displayDollarOpen = false;
        state.hasMath = true;
      }
      return `${standaloneDisplay[1] ?? ""}$$`;
    }

    return normalizeInlineMath(line, state);
  }).join("\n");

  return { source: normalized, hasMath: state.hasMath };
}

function normalizeInlineMath(line: string, state: MathNormalizationState): string {
  let result = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      const runLength = repeatedCharacterLength(line, index, "`");
      if (state.inlineTicks === 0) state.inlineTicks = runLength;
      else if (state.inlineTicks === runLength) state.inlineTicks = 0;
      result += line.slice(index, index + runLength);
      index += runLength;
      continue;
    }

    if (state.inlineTicks > 0) {
      result += line[index];
      index += 1;
      continue;
    }

    if (line.startsWith("$$", index) && !isEscaped(line, index)) {
      if (state.displayDollarOpen) {
        state.displayDollarOpen = false;
        state.hasMath = true;
      } else {
        state.displayDollarOpen = true;
      }
      result += "$$";
      index += 2;
      continue;
    }

    if (state.displayDollarOpen) {
      result += line[index];
      index += 1;
      continue;
    }

    if (line.startsWith("\\(", index) && !isEscaped(line, index)) {
      const close = findClosingToken(line, index + 2, "\\)");
      if (close >= 0) {
        state.hasMath = true;
        result += `$$${line.slice(index + 2, close)}$$`;
        index = close + 2;
        continue;
      }
    }

    if (line.startsWith("\\[", index) && !isEscaped(line, index)) {
      const close = findClosingToken(line, index + 2, "\\]");
      if (close >= 0) {
        state.hasMath = true;
        const expression = line.slice(index + 2, close).trim();
        const prefixBreak = result.length === 0 || result.endsWith("\n") ? "" : "\n\n";
        const suffixBreak = close + 2 >= line.length ? "" : "\n\n";
        result += `${prefixBreak}$$\n${expression}\n$$${suffixBreak}`;
        index = close + 2;
        continue;
      }
    }

    if (line[index] === "$" && !isEscaped(line, index)) {
      const close = findClosingDollar(line, index + 1);
      if (close >= 0) {
        const expression = line.slice(index + 1, close);
        if (looksLikeInlineMath(expression)) {
          state.hasMath = true;
          result += `$$${expression}$$`;
          index = close + 1;
          continue;
        }
      }
    }

    result += line[index];
    index += 1;
  }

  return result;
}

function markdownFence(line: string): {
  marker: "`" | "~";
  length: number;
  closing: boolean;
  info: string;
} | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match?.[1]) return undefined;
  const marker = match[1][0] as "`" | "~";
  const suffix = match[2] ?? "";
  return {
    marker,
    length: match[1].length,
    closing: suffix.trim() === "",
    info: suffix.trim().split(/\s+/u)[0]?.toLocaleLowerCase() ?? ""
  };
}

function findClosingToken(value: string, from: number, token: "\\)" | "\\]"): number {
  for (let index = from; index <= value.length - token.length; index += 1) {
    if (value.startsWith(token, index) && !isEscaped(value, index)) return index;
  }
  return -1;
}

function findClosingDollar(value: string, from: number): number {
  for (let index = from; index < value.length; index += 1) {
    if (value[index] !== "$" || isEscaped(value, index)) continue;
    if (value[index - 1] === "$" || value[index + 1] === "$") continue;
    return index;
  }
  return -1;
}

function looksLikeInlineMath(expression: string): boolean {
  if (!expression || expression.trim() !== expression || expression.includes("\n")) return false;
  if (/^\d[\d,.]*$/u.test(expression)) return false;
  if (/^[A-Za-zΑ-ω]$/u.test(expression)) return true;
  return /[A-Za-zΑ-ω\\_^{}=+*/<>()[\]∑∫√±×÷≤≥≠]/u.test(expression);
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function repeatedCharacterLength(value: string, index: number, character: string): number {
  let cursor = index;
  while (value[cursor] === character) cursor += 1;
  return cursor - index;
}
