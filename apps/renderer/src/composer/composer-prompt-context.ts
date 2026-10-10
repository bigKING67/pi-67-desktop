// A surface may attach a structured block to prompts sent while it is shown
// (the image page's `<image-context>`, ADR 0010). One provider at a time; the
// block follows the person's words and is hidden again in the transcript.

type PromptContextProvider = () => string | undefined;
let provider: PromptContextProvider | undefined;
let onAccepted: (() => void) | undefined;
/** Set when the last submission carried a block, so only that block's surface learns it was delivered. */
let pendingDelivery: (() => void) | undefined;

/**
 * Installs the provider and returns its release; a newer provider replaces an
 * older one. `accepted` runs once a prompt carrying the block is accepted, so a
 * surface can retire what it sent (the image page's marks) only when it arrived.
 */
export function setComposerPromptContext(next: PromptContextProvider, accepted?: () => void): () => void {
  provider = next;
  onAccepted = accepted;
  // A prompt already in flight still learns of its acceptance after the surface leaves.
  return () => { if (provider === next) { provider = undefined; onAccepted = undefined; } };
}

export function composerPromptContext(): string | undefined {
  const block = provider?.();
  pendingDelivery = block ? onAccepted : undefined;
  return block;
}

/** The submission that last read the block was accepted by the Host. */
export function composerPromptContextAccepted(): void {
  const delivered = pendingDelivery;
  pendingDelivery = undefined;
  delivered?.();
}
