import { MAX_PROMPT_TEXT_CHARS } from "@pi67/protocol";

export function promptTextValidationMessage(text: string): string | undefined {
  const excessCharacters = unicodeCharacterCount(text) - MAX_PROMPT_TEXT_CHARS;
  if (excessCharacters <= 0) return undefined;
  return `消息超出 ${MAX_PROMPT_TEXT_CHARS.toLocaleString("zh-CN")} 字符上限（多出 ${excessCharacters.toLocaleString("zh-CN")} 个字符）。请缩短或拆分后再发送。`;
}

function unicodeCharacterCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const current = text.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}
