import { describe, expect, it } from "vitest";
import {
  collectProcessOwnedMemoryBytes,
  parseMacPhysicalFootprints
} from "./electron-process-memory.mjs";

describe("Electron process memory evidence", () => {
  it("parses per-process macOS physical footprints without using the aggregate summary", () => {
    const footprints = parseMacPhysicalFootprints(`
======================================================================
Pi-67 Desktop [120]: 64-bit    Footprint: 1000 B (16384 bytes per page)
======================================================================

Auxiliary data:
    phys_footprint: 1100 B
    phys_footprint_peak: 1200 B

======================================================================
Pi-67 Desktop Helper [121]: 64-bit    Footprint: 2000 B (16384 bytes per page)
======================================================================

Auxiliary data:
    phys_footprint: 2100 B
    phys_footprint_peak: 2200 B

======================================================================
Summary Footprint: 3000 B
======================================================================
`);

    expect([...footprints]).toEqual([
      [120, 1100],
      [121, 2100]
    ]);
  });

  it("uses Windows PrivatePageCount without conflating it with WorkingSetSize", () => {
    const owned = collectProcessOwnedMemoryBytes(new Map([
      ["main", { pid: 1, privateBytes: 10, rssBytes: 100 }],
      ["renderer", { pid: 2, privateBytes: 20, rssBytes: 200 }]
    ]), "win32");

    expect([...owned]).toEqual([
      ["main", 10],
      ["renderer", 20]
    ]);
  });

  it("fails closed when Windows private-memory evidence is unavailable", () => {
    expect(() => collectProcessOwnedMemoryBytes(new Map([
      ["main", { pid: 1, rssBytes: 100 }]
    ]), "win32")).toThrow("missing PrivatePageCount");
  });
});
