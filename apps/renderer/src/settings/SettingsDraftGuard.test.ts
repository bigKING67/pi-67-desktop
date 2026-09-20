import { describe, expect, it, vi } from "vitest";
import { combineSettingsDrafts } from "./SettingsDraftGuard.js";

describe("multiple settings transactions", () => {
  it("keeps both dirty forms guarded and discards each once", () => {
    const first = { dirty: true, busy: false, subject: "privacy", discard: vi.fn() };
    const second = { dirty: true, busy: false, subject: "models", discard: vi.fn() };
    const combined = combineSettingsDrafts([first, second])!;
    expect(combined).toMatchObject({ dirty: true, busy: false, subject: "privacy、models" });
    combined.discard(); expect(first.discard).toHaveBeenCalledTimes(1); expect(second.discard).toHaveBeenCalledTimes(1);
    expect(combineSettingsDrafts([first])).toMatchObject({ dirty: true, subject: "privacy" });
  });
  it("keeps an idle sibling from masking pending work and does not discard clean forms", () => {
    const pending = { dirty: false, busy: true, subject: "models", discard: vi.fn() };
    const clean = { dirty: false, busy: false, subject: "privacy", discard: vi.fn() };
    const combined = combineSettingsDrafts([pending, clean])!;
    expect(combined).toMatchObject({ dirty: false, busy: true, subject: "models" });
    combined.discard(); expect(pending.discard).not.toHaveBeenCalled(); expect(clean.discard).not.toHaveBeenCalled();
    expect(combineSettingsDrafts([])).toBeUndefined();
  });
});
