import { describe, expect, it } from "vitest";
import { packagedApplicationEnvironment } from "./packaged-electron-fixture.mjs";

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
});
