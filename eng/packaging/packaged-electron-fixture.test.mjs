import { describe, expect, it } from "vitest";
import {
  packagedApplicationEnvironment,
  packagedAttachmentExcludedAsarPaths,
  packagedAttachmentRequiredAsarPaths
} from "./packaged-electron-fixture.mjs";

describe("packaged Electron launch environment", () => {
  it("injects an external renderer URL only when probing packaged isolation", () => {
    const environment = packagedApplicationEnvironment({
      agentDir: "C:\\fixture\\agent",
      hostEnvironment: {
        PATH: "C:\\Windows",
        PI67_RENDERER_DEV_URL: "https://inherited.invalid/"
      }
    });

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      PATH: "C:\\Windows",
      PI_CODING_AGENT_DIR: "C:\\fixture\\agent",
      PI_OFFLINE: "1",
      PI67_RENDERER_DEV_URL: "https://renderer.invalid/"
    });
  });

  it("removes inherited renderer overrides for legacy baseline launches", () => {
    const environment = packagedApplicationEnvironment({
      agentDir: "C:\\fixture\\agent",
      hostEnvironment: {
        PATH: "C:\\Windows",
        PI67_RENDERER_DEV_URL: "https://inherited.invalid/"
      },
      probePackagedRendererIsolation: false
    });

    expect(environment).toMatchObject({
      NODE_ENV: "test",
      PATH: "C:\\Windows",
      PI_CODING_AGENT_DIR: "C:\\fixture\\agent",
      PI_OFFLINE: "1"
    });
    expect(environment).not.toHaveProperty("PI67_RENDERER_DEV_URL");
  });

  it("allows an explicit caller override after the default probe policy", () => {
    const environment = packagedApplicationEnvironment({
      agentDir: "C:\\fixture\\agent",
      environment: { PI67_RENDERER_DEV_URL: "http://127.0.0.1:5173" },
      hostEnvironment: {},
      probePackagedRendererIsolation: false
    });

    expect(environment.PI67_RENDERER_DEV_URL).toBe("http://127.0.0.1:5173");
  });

  it("removes inherited and caller-provided offline mode for the real-user lifecycle", () => {
    const environment = packagedApplicationEnvironment({
      agentDir: "C:\\fixture\\agent",
      environment: { PI_OFFLINE: "caller-value" },
      hostEnvironment: { PI_OFFLINE: "inherited-value" },
      offline: false
    });

    expect(environment).not.toHaveProperty("PI_OFFLINE");
  });

  it("keeps every Node OCR fallback while excluding browser-only payloads", () => {
    expect(packagedAttachmentRequiredAsarPaths).toEqual(expect.arrayContaining([
      "node_modules/tesseract.js-core/tesseract-core.wasm",
      "node_modules/tesseract.js-core/tesseract-core-simd.wasm",
      "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm",
      "node_modules/tesseract.js-core/tesseract-core-lstm.wasm",
      "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
      "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm",
      "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
      "node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz",
      "node_modules/officeparser/dist/index.mjs"
    ]));
    expect(packagedAttachmentExcludedAsarPaths).toEqual(expect.arrayContaining([
      "node_modules/tesseract.js-core/tesseract-core.wasm.js",
      "node_modules/tesseract.js-core/tesseract-core-simd.wasm.js",
      "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js",
      "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
      "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
      "node_modules/officeparser/dist/officeparser.browser.mjs"
    ]));
  });
});
