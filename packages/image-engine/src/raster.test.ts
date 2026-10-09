import path from "node:path";
import { describe, expect, it } from "vitest";
import { topLevelEntry } from "./raster.js";

describe("raster paths", () => {
  it("finds the entry below the filesystem root on POSIX and Windows", () => {
    expect(topLevelEntry("/tmp/project/a.png", path.posix)).toBe("/tmp");
    expect(topLevelEntry("/", path.posix)).toBe("/");
    // The drive is part of the root; splitting the whole path once produced `C:\C:`.
    expect(topLevelEntry("C:\\Users\\runner\\a.png", path.win32)).toBe("C:\\Users");
    expect(topLevelEntry("D:\\", path.win32)).toBe("D:\\");
    expect(topLevelEntry("\\\\server\\share\\photos\\a.png", path.win32)).toBe("\\\\server\\share\\photos");
  });
});
