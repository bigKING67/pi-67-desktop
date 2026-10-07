const PREVIEW_LIMIT = 160;

/**
 * One plain-text line for a collapsed reasoning disclosure: the latest non-empty
 * sentence, with Markdown markers stripped. The full text stays in the disclosure.
 */
export function reasoningPreview(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => stripMarkdown(line))
    .filter((line) => line !== "");
  const last = lines.at(-1);
  if (last === undefined) return "";
  // CJK terminators always end a sentence; ASCII ones only before whitespace, so
  // file names such as `package.json` stay whole.
  const sentences = last.split(/(?<=[。！？])|(?<=[.!?])\s+/u);
  const sentence = sentences.map((part) => part.trim()).filter((part) => part !== "").at(-1) ?? last;
  return sentence.length > PREVIEW_LIMIT ? `${sentence.slice(0, PREVIEW_LIMIT - 1)}…` : sentence;
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/u, "")
    .replace(/[*_`~]+/gu, "")
    .trim();
}
