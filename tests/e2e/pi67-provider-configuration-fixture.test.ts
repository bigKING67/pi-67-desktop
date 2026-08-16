import {
  isResponseEnvelope,
  responseEnvelope
} from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import { createMockProviderConfigurationSnapshot } from "./pi67-renderer-fixture.js";

describe("renderer Provider configuration fixture", () => {
  it("returns a protocol-valid Pi configuration snapshot", () => {
    const response = responseEnvelope("provider-configuration", 1, { scope: "app" }, {
      ok: true,
      type: "provider.configuration.get",
      result: createMockProviderConfigurationSnapshot()
    });
    expect(isResponseEnvelope(response)).toBe(true);
  });
});
