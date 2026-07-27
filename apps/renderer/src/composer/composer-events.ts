const COMPOSER_PREFILL_EVENT = "pi67:composer-prefill";

export function requestComposerPrefill(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(COMPOSER_PREFILL_EVENT, { detail: text }));
}

export function subscribeToComposerPrefill(listener: (text: string) => void): () => void {
  const onPrefill = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    listener(event.detail);
  };
  window.addEventListener(COMPOSER_PREFILL_EVENT, onPrefill);
  return () => window.removeEventListener(COMPOSER_PREFILL_EVENT, onPrefill);
}
