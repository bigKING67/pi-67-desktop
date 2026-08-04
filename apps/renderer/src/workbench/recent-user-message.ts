import { conversationTitleCandidate, type SessionMessageView } from "@pi67/domain";

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
  return conversationTitleCandidate(text, hasImage);
}
