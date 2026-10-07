import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextPressureValue, contextPressureTone } from "./ComposerContextPressure.js";

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
    [49.4, false],
    [49.6, true],
    [50, true],
    [80, true]
  ])("fills the ring and shows the numeric percent only from half the window: %s%%", (percent, numeric) => {
    const markup = renderToStaticMarkup(createElement(ContextPressureValue, { percent }));
    // The percent always remains text for the live region; below half it is screen-reader only.
    expect(markup).toContain(`${percent.toFixed(0)}%</span>`);
    expect(markup.includes(`<span class="sr-only">${percent.toFixed(0)}%</span>`)).toBe(!numeric);
    expect(markup.includes("stroke-dasharray")).toBe(percent > 0);
  });
});
