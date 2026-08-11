import { describe, expect, it } from "vitest";
import {
  nativeCapabilityReplacement,
  nativeCapabilityReplacementLabel
} from "./native-capability-replacements.js";

describe("native capability replacements", () => {
  it("recognizes retired Plan and Search packages across pinned semver forms", () => {
    expect(nativeCapabilityReplacement("npm:@narumitw/pi-plan-mode@^1.2.3")).toBe("native-plan");
    expect(nativeCapabilityReplacement("npm:pi-web-access@~0.17.0")).toBe("native-web");
    expect(nativeCapabilityReplacement(" npm:pi-smart-fetch@2.0.0 ")).toBe("native-web");
    expect(nativeCapabilityReplacement("npm:pi-subagents@0.46.0")).toBe("native-subagents");
    expect(nativeCapabilityReplacement("npm:another-package@1.0.0")).toBeUndefined();
  });

  it("names the first-party replacement without conflating Plan and Search", () => {
    expect(nativeCapabilityReplacementLabel("native-plan")).toBe("由 Pi-67 原生 Plan Mode 替代");
    expect(nativeCapabilityReplacementLabel("native-web")).toBe("由 Pi-67 原生搜索替代");
    expect(nativeCapabilityReplacementLabel("native-subagents")).toBe("由 Pi-67 原生子代理替代");
  });
});
