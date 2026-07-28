import type { SessionMessageView } from "@pi67/domain";

const MAX_PREVIEW_GRAPHEMES = 72;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function latestUserMessagePreview(
  messages: readonly SessionMessageView[]
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.parts.flatMap((part) => (
      part.type === "text" ? [part.text] : []
    )).join(" ");
    const preview = userMessagePreview(
      text,
      message.parts.some((part) => part.type === "image")
    );
    if (preview) return preview;
  }
  return undefined;
}

export function userMessagePreview(
  text: string,
  hasImage = false
): string | undefined {
  const normalized = replaceUnsafeCharacters(text)
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return hasImage ? "图片消息" : undefined;
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(normalized), ({ segment }) => segment);
  return graphemes.length <= MAX_PREVIEW_GRAPHEMES
    ? normalized
    : `${graphemes.slice(0, MAX_PREVIEW_GRAPHEMES).join("")}…`;
}

function replaceUnsafeCharacters(text: string): string {
  let safe = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const unsafe = codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
    safe += unsafe ? " " : character;
  }
  return safe;
}
