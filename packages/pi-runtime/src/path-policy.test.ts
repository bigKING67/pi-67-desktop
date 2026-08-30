import { describe, expect, it } from "vitest";
import { normalizeShellPathForPlatform } from "./path-policy.js";

describe("normalizeShellPathForPlatform", () => {
  it("normalizes Git Bash drive paths only for Windows", () => {
    expect(normalizeShellPathForPlatform("/c/study/AGI", "win32")).toBe("C:\\study\\AGI");
    expect(normalizeShellPathForPlatform("/D/Work Tree/project", "win32")).toBe("D:\\Work Tree\\project");
    expect(normalizeShellPathForPlatform("/c", "win32")).toBe("C:\\");
    expect(normalizeShellPathForPlatform("C:/study/AGI", "win32")).toBe("C:/study/AGI");
    expect(normalizeShellPathForPlatform("/usr/bin", "win32")).toBe("/usr/bin");
    expect(normalizeShellPathForPlatform("/c/study/AGI", "darwin")).toBe("/c/study/AGI");
  });
});
