import { describe, expect, it } from "vitest";
import {
  INTEGRATION_STATE_SCHEMA,
  parseBrowserState
} from "./desktop-capability-contract.js";

describe("browser67 persisted integration state", () => {
  it("migrates the legacy state without treating existing users as corrupted", () => {
    expect(parseBrowserState({
      schema: "pi67.desktop-integration-state.v1",
      dependencyState: "prepared",
      doctorState: "ready",
      detail: "Legacy live check passed.",
      preparedAt: 10,
      checkedAt: 20,
      registry: "https://registry.npmjs.org"
    })).toEqual({
      schema: INTEGRATION_STATE_SCHEMA,
      dependencyState: "prepared",
      extensionState: "not-prepared",
      doctorState: "ready",
      detail: "Legacy live check passed.",
      preparedAt: 10,
      checkedAt: 20,
      registry: "https://registry.npmjs.org"
    });
  });

  it("accepts bounded v2 metadata and rejects malformed optional fields", () => {
    const valid = {
      schema: INTEGRATION_STATE_SCHEMA,
      dependencyState: "prepared",
      extensionState: "connected",
      doctorState: "ready",
      detail: "Live identity verified.",
      preparedAt: 10,
      checkedAt: 20,
      extensionPreparedAt: 30,
      extensionCheckedAt: 40,
      registry: "https://registry.npmjs.org"
    };
    expect(parseBrowserState(valid)).toEqual(valid);

    for (const invalid of [
      { ...valid, detail: 42 },
      { ...valid, extensionPreparedAt: -1 },
      { ...valid, extensionCheckedAt: Number.NaN },
      { ...valid, registry: false }
    ]) {
      expect(() => parseBrowserState(invalid)).toThrow("browser67 integration state is invalid.");
    }
  });
});
