export function pageMetadata(
  messages: readonly { id: string }[],
  hasOlder: boolean,
  hasNewer: boolean
): Record<string, unknown> {
  return {
    ...(messages[0] === undefined ? {} : { startCursor: messages[0].id }),
    ...(messages.at(-1) === undefined ? {} : { endCursor: messages.at(-1)!.id }),
    hasOlder,
    hasNewer
  };
}
