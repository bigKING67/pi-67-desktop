import { describe, expect, it } from "vitest";
import { contextPressureTone } from "./ComposerContextPressure.js";

describe("Composer context pressure", () => {
  it("uses fixed product thresholds without a user-facing switch", () => {
    expect(contextPressureTone(0)).toBe("normal");
    expect(contextPressureTone(74.9)).toBe("normal");
    expect(contextPressureTone(75)).toBe("warning");
    expect(contextPressureTone(91.9)).toBe("warning");
    expect(contextPressureTone(92)).toBe("critical");
  });
});
