import { describe, expect, it } from "vitest";
import { isImeConfirmationKey } from "./ime-keyboard.js";

describe("IME keyboard boundary", () => {
  it("recognizes active composition and the Windows legacy key code", () => {
    expect(isImeConfirmationKey({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeConfirmationKey({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeConfirmationKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
