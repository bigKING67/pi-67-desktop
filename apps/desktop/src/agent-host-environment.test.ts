import { describe, expect, it } from "vitest";
import { agentHostEnvironment } from "./agent-host-environment.js";

describe("Agent Host environment", () => {
  it("overrides externally supplied storage and telemetry paths with Main-owned values", () => {
    expect(agentHostEnvironment({
      PI67_CAPABILITY_PROBE_DIR: "/untrusted",
      PI67_SESSION_CATALOG_DIR: "/also-untrusted",
      PI67_STORAGE_ROOT: "/also-untrusted-root",
      PI67_DESKTOP: "0",
      PI_TELEMETRY: "1"
    }, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/app/user-data",
      sessionCatalogDirectory: "/app/user-data/projections/session-catalog"
    })).toMatchObject({
      PI67_CAPABILITY_PROBE_DIR: "/app/user-data",
      PI67_SESSION_CATALOG_DIR: "/app/user-data/projections/session-catalog",
      PI67_STORAGE_ROOT: "/app/user-data",
      PI67_DESKTOP: "1",
      PI_TELEMETRY: "0"
    });
  });

  it("rejects forged storage values that escape the Main-owned layout", () => {
    expect(() => agentHostEnvironment({}, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/app/user-data",
      sessionCatalogDirectory: "/outside/session-catalog"
    })).toThrow("Main-owned userData layout");

    expect(() => agentHostEnvironment({}, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/outside",
      sessionCatalogDirectory: "/app/user-data/projections/session-catalog"
    })).toThrow("Main-owned userData layout");
  });
});
