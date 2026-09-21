let localCounter = 0;

export function createMessageId(prefix: string): string {
  localCounter = (localCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${localCounter.toString(36)}`;
}
