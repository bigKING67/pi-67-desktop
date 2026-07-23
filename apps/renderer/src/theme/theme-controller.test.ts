import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme } from "./theme-controller.js";

describe("theme controller policy", () => {
  it("accepts supported preferences and rejects stale storage values", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("midnight")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("resolves system preference without overriding explicit choices", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
