import { describe, expect, it } from "vitest";
import { compareLarkCliVersions, isLarkCliVersion } from "./lark-cli-version.js";

describe("Lark CLI version policy", () => {
  it("orders stable semantic versions without allowing lexical downgrade mistakes", () => {
    expect(compareLarkCliVersions("1.0.88", "1.0.9")).toBeGreaterThan(0);
    expect(compareLarkCliVersions("1.1.0", "1.0.99")).toBeGreaterThan(0);
    expect(compareLarkCliVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("orders prereleases below their stable release", () => {
    expect(compareLarkCliVersions("1.0.88-beta.2", "1.0.88-beta.1")).toBeGreaterThan(0);
    expect(compareLarkCliVersions(
      "1.0.88-beta.100000000000000000000",
      "1.0.88-beta.99999999999999999999"
    )).toBeGreaterThan(0);
    expect(compareLarkCliVersions("1.0.88", "1.0.88-beta.2")).toBeGreaterThan(0);
  });

  it("rejects non-semantic channel values", () => {
    expect(isLarkCliVersion("1.0.88")).toBe(true);
    expect(isLarkCliVersion("latest")).toBe(false);
    expect(isLarkCliVersion("9007199254740992.0.0")).toBe(false);
    expect(() => compareLarkCliVersions("latest", "1.0.88")).toThrow();
  });
});
