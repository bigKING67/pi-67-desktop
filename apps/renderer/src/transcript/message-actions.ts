import type { SessionMessageView } from "@pi67/domain";

export function messageTextForCopy(message: SessionMessageView): string | undefined {
  const text = message.parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n\n")
    .trim();
  return text || undefined;
}

export function editableUserMessageText(message: SessionMessageView): string | undefined {
  if (message.role !== "user" || message.parts.some((part) => part.type === "image")) {
    return undefined;
  }
  return messageTextForCopy(message);
}

export function userMessageContainsImage(message: SessionMessageView): boolean {
  return message.role === "user" && message.parts.some((part) => part.type === "image");
}
