import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextPressureValue, contextPressureTone, isContextPressureVisible } from "./ComposerContextPressure.js";

describe("Composer context pressure", () => {
  it("uses fixed product thresholds without a user-facing switch", () => {
    expect(contextPressureTone(0)).toBe("normal");
    expect(contextPressureTone(74.9)).toBe("normal");
    expect(contextPressureTone(75)).toBe("warning");
    expect(contextPressureTone(91.9)).toBe("warning");
    expect(contextPressureTone(92)).toBe("critical");
  });

  it.each([
    [0, false],
    [12, false],
    [49.4, false],
    [49.6, true],
    [50, true],
    [80, true]
  ])("appears in the Composer only from half the window: %s%%", (percent, visible) => {
    expect(isContextPressureVisible(percent)).toBe(visible);
  });

  it("fills the ring with the exact value beside the visible percent", () => {
    const markup = renderToStaticMarkup(createElement(ContextPressureValue, { percent: 63 }));
    expect(markup).toContain("<span>63%</span>");
    expect(markup).toContain("stroke-dasharray");
  });
});
