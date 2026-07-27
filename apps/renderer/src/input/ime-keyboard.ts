export interface ImeKeyboardEvent {
  isComposing: boolean;
  keyCode: number;
}

export function isImeConfirmationKey(event: ImeKeyboardEvent): boolean {
  // Chromium reports isComposing; keyCode 229 covers legacy Windows IME confirmation events.
  return event.isComposing || event.keyCode === 229;
}
