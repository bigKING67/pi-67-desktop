import { describe, expect, it, vi } from "vitest";
import {
  isolatePackagedAutomationWindow,
  packagedApplicationEnvironment,
  packagedAttachmentExcludedAsarPaths,
  packagedAttachmentRequiredAsarPaths,
  resolvePackagedRuntimeAssetContract,
  WINDOWS_PACKAGE_WORKER_ISOLATION_VERSION
} from "./packaged-electron-fixture.mjs";

describe("packaged Electron launch environment", () => {
  it("keeps automation windows hidden from native operator input", async () => {
    let showHandler;
    const window = {
      hide: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event, handler) => {
        if (event === "show") showHandler = handler;
      }),
      blur: vi.fn(),
      setFocusable: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setSkipTaskbar: vi.fn(),
      webContents: { setBackgroundThrottling: vi.fn() }
    };
    const application = {
      evaluate: vi.fn(async (callback, argument) => callback({
        BrowserWindow: { getAllWindows: () => [window] }
      }, argument)),
      firstWindow: vi.fn(async () => ({}))
    };

    await isolatePackagedAutomationWindow(application);

    expect(application.firstWindow).toHaveBeenCalledOnce();
    expect(window.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(window.setFocusable).toHaveBeenCalledWith(false);
    expect(window.setSkipTaskbar).not.toHaveBeenCalled();
    expect(window.blur).not.toHaveBeenCalled();
    expect(window.hide).toHaveBeenCalledOnce();
    showHandler?.();
    expect(window.hide).toHaveBeenCalledTimes(2);
  });

  it("keeps visual-evidence windows compositable while blocking operator input", async () => {
    const window = {
      blur: vi.fn(),
      hide: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
      setFocusable: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setSkipTaskbar: vi.fn(),
      webContents: { setBackgroundThrottling: vi.fn() }
    };
    const application = {
      evaluate: vi.fn(async (callback, argument) => callback({
        BrowserWindow: { getAllWindows: () => [window] }
      }, argument)),
      firstWindow: vi.fn(async () => ({}))
    };

    await isolatePackagedAutomationWindow(application, { hideNativeWindow: false });

    expect(application.firstWindow).toHaveBeenCalledOnce();
    expect(window.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(window.setFocusable).not.toHaveBeenCalled();
    expect(window.setSkipTaskbar).toHaveBeenCalledWith(true);
    expect(window.blur).toHaveBeenCalledOnce();
    expect(window.on).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

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

  it("uses the asset contract of the version that is actually installed", () => {
    const legacy = resolvePackagedRuntimeAssetContract("0.1.0-alpha.22");
    expect(WINDOWS_PACKAGE_WORKER_ISOLATION_VERSION).toBe("0.1.0-alpha.24");
    expect(legacy).toMatchObject({
      packageWorkerIsolated: false,
      requireWindowsPackageWorkerJob: false
    });
    expect(legacy.requiredAsarPaths).not.toContain(
      "apps/agent-host/dist/skill-pack-process-worker.mjs"
    );

    const isolated = resolvePackagedRuntimeAssetContract("0.1.0-alpha.24");
    expect(isolated).toMatchObject({
      packageWorkerIsolated: true,
      requireWindowsPackageWorkerJob: true
    });
    expect(isolated.requiredAsarPaths).toContain(
      "apps/agent-host/dist/skill-pack-process-worker.mjs"
    );
    expect(resolvePackagedRuntimeAssetContract("0.1.0-alpha.24"))
      .toMatchObject({ packageWorkerIsolated: true });
    expect(() => resolvePackagedRuntimeAssetContract("not-a-version"))
      .toThrow("Invalid version for packaged Runtime asset contract");
  });
});
