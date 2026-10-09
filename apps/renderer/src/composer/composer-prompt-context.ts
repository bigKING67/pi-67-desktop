// A surface may attach a structured block to prompts sent while it is shown
// (the image page's `<image-context>`, ADR 0010). One provider at a time; the
// block follows the person's words and is hidden again in the transcript.

type PromptContextProvider = () => string | undefined;
let provider: PromptContextProvider | undefined;

/** Installs the provider and returns its release; a newer provider replaces an older one. */
export function setComposerPromptContext(next: PromptContextProvider): () => void {
  provider = next;
  return () => { if (provider === next) provider = undefined; };
}

export function composerPromptContext(): string | undefined {
  return provider?.();
}
