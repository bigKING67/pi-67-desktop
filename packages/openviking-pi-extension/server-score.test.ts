import { describe, expect, it } from "vitest";
import { scoreScaleForVersion, toRawCosine, toServerScore } from "./server-score.js";

describe("OpenViking server score scale", () => {
  it("normalizes from 0.4.22 and treats unknown versions as normalized", () => {
    expect(scoreScaleForVersion("0.4.16")).toBe("raw-cosine");
    expect(scoreScaleForVersion("0.4.21")).toBe("raw-cosine");
    expect(scoreScaleForVersion("0.4.22")).toBe("normalized-cosine");
    expect(scoreScaleForVersion("0.5.0")).toBe("normalized-cosine");
    expect(scoreScaleForVersion("fixture")).toBe("normalized-cosine");
    expect(scoreScaleForVersion(undefined)).toBe("normalized-cosine");
  });

  it("converts raw-cosine settings and gates both ways", () => {
    expect(toServerScore(0.48, "normalized-cosine")).toBeCloseTo(0.74);
    expect(toServerScore(0.48, "raw-cosine")).toBe(0.48);
    expect(toRawCosine(0.9, "normalized-cosine")).toBeCloseTo(0.8);
    expect(toRawCosine(toServerScore(0.8, "normalized-cosine"), "normalized-cosine")).toBeCloseTo(0.8);
  });
});
