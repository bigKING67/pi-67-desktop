const MAX_VISIBLE_QUEUE_ITEMS = 20;
const MAX_QUEUE_PREVIEW_CHARACTERS = 500;

export interface QueueItemView {
  id: string;
  kind: "steer" | "follow-up";
  preview: string;
  truncated: boolean;
}

export function projectQueue(steering: string[], followUp: string[]) {
  const items: QueueItemView[] = [];
  appendQueueItems(items, steering, "steer");
  appendQueueItems(items, followUp, "follow-up");
  return {
    items,
    steeringCount: steering.length,
    followUpCount: followUp.length,
    hiddenCount: Math.max(0, steering.length + followUp.length - items.length)
  };
}

function appendQueueItems(target: QueueItemView[], messages: string[], kind: QueueItemView["kind"]): void {
  for (let index = 0; index < messages.length && target.length < MAX_VISIBLE_QUEUE_ITEMS; index += 1) {
    const message = messages[index] ?? "";
    target.push({
      id: `${kind}-${index}`,
      kind,
      preview: sanitizeQueuePreview(message),
      truncated: message.length > MAX_QUEUE_PREVIEW_CHARACTERS
    });
  }
}

function sanitizeQueuePreview(message: string): string {
  let preview = "";
  for (const character of message.slice(0, MAX_QUEUE_PREVIEW_CHARACTERS)) {
    const codePoint = character.codePointAt(0) ?? 0;
    preview += codePoint < 32 || codePoint === 127 ? " " : character;
  }
  return preview.replace(/\s+/gu, " ").trim();
}
