import { describe, expect, it } from "vitest";
import { findUnsupportedSandboxPreloadModules } from "./verify-sandbox-preload-bundle.mjs";

describe("sandbox preload bundle verification", () => {
  it("accepts only modules exposed by Electron sandboxed preload", () => {
    expect(findUnsupportedSandboxPreloadModules(`
      const electron = require("electron");
      const events = require("node:events");
      const timers = require('timers');
    `)).toEqual([]);
  });

  it("rejects workspace and arbitrary Node runtime dependencies", () => {
    expect(findUnsupportedSandboxPreloadModules(`
      const protocol = require("@pi67/protocol");
      const fs = require("node:fs");
      require("@pi67/protocol");
    `)).toEqual(["@pi67/protocol", "node:fs"]);
  });
});
