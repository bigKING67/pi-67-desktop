import { describe, expect, it, vi } from "vitest";
import {
  assertRendererResourceBoundaries,
  printRendererResourceAttribution,
  rendererStageAssetMiBSamples,
  summarizeRendererResourceTransitions
} from "./electron-renderer-resources.mjs";

const resource = (name, decodedBodyBytes, initiatorType = "script") => ({
  name,
  initiatorType,
  decodedBodyBytes,
  transferBytes: decodedBodyBytes,
  assetFileBytes: decodedBodyBytes,
  durationMs: 10
});

describe("packaged renderer resource attribution", () => {
  it("attributes only resources added by each lifecycle stage", () => {
    const report = summarizeRendererResourceTransitions([
      {
        welcome: [resource("/assets/index.js", 100)],
        runtimeInitialization: [resource("/assets/virtualization.js", 200)],
        sessionRestore: [resource("/assets/markdown.js", 300)]
      },
      {
        welcome: [resource("/assets/index.js", 100)],
        runtimeInitialization: [resource("/assets/virtualization.js", 200)],
        sessionRestore: []
      }
    ]);

    expect(report.stages.welcome.resourceCount.p95).toBe(1);
    expect(report.stages.welcome.assetFileMiB.p95).toBeCloseTo(100 / 1024 / 1024, 3);
    expect(report.stages.runtimeInitialization.resources).toMatchObject([
      { name: "/assets/virtualization.js", sampleCount: 2, sampleRate: 1 }
    ]);
    expect(report.stages.sessionRestore.resourceCount).toMatchObject({ p50: 0, p95: 1 });
    expect(report.stages.sessionRestore.resources).toMatchObject([
      { name: "/assets/markdown.js", sampleCount: 1, sampleRate: 0.5 }
    ]);
    expect(rendererStageAssetMiBSamples([{
      welcome: [resource("/assets/index.js", 512 * 1024)],
      runtimeInitialization: [],
      sessionRestore: []
    }], "welcome")).toEqual([0.5]);
  });

  it("enforces deferred workspace and overlay resource boundaries", () => {
    expect(() => assertRendererResourceBoundaries({
      welcome: [resource("/assets/index.js", 100)],
      runtimeInitialization: [resource("/assets/WorkspaceShell.js", 200)],
      sessionRestore: []
    })).not.toThrow();
    expect(() => assertRendererResourceBoundaries({
      welcome: [resource("/assets/CommandPalette.js", 100)],
      runtimeInitialization: [],
      sessionRestore: []
    })).toThrow(/resource boundary violation/u);
    expect(() => assertRendererResourceBoundaries({
      welcome: [],
      runtimeInitialization: [resource("/assets/ApprovalDialog.js", 100)],
      sessionRestore: []
    })).toThrow(/resource boundary violation/u);
  });

  it("prints bounded stage evidence without raw renderer payloads", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const report = summarizeRendererResourceTransitions([{
      welcome: [resource("/assets/index.js", 100)],
      runtimeInitialization: [],
      sessionRestore: []
    }]);

    printRendererResourceAttribution(report);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("welcome"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("assets"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("/assets/index.js"));
    log.mockRestore();
  });
});
