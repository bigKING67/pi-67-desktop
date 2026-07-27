import { describe, expect, it } from "vitest";
import {
  assertLayoutObservation,
  WINDOWS_SYNTHETIC_SCALE_FACTORS
} from "./verify-windows-packaged-input-layout.mjs";

describe("Windows packaged synthetic-scale UI contract", () => {
  it("keeps the release scale matrix explicit", () => {
    expect(WINDOWS_SYNTHETIC_SCALE_FACTORS).toEqual([1.25, 1.5, 2]);
  });

  it("accepts contained topmost controls and the native title-bar reserve", () => {
    expect(() => assertLayoutObservation(observation(), {
      breakpoint: "context-drawer",
      expectedWidth: 1_040,
      requestedScaleFactor: 1.5
    })).not.toThrow();
  });

  it("rejects covered controls and horizontal overflow", () => {
    expect(() => assertLayoutObservation({
      ...observation(),
      horizontalOverflow: 12,
      send: { contained: true, topmost: false }
    }, {
      breakpoint: "context-drawer",
      expectedWidth: 1_040,
      requestedScaleFactor: 1.5
    })).toThrow(/overflows horizontally/u);
  });
});

function observation() {
  return {
    composer: { bottom: 780, height: 140, left: 240, right: 1_030, top: 640, width: 790 },
    contextDrawerVisible: true,
    devicePixelRatio: 1.5,
    horizontalOverflow: 0,
    innerHeight: 800,
    innerWidth: 1_040,
    matchesContextBreakpoint: true,
    matchesNavigationBreakpoint: false,
    navigationDrawerVisible: false,
    send: { contained: true, topmost: true },
    stop: { contained: true, topmost: true },
    titleBar: { bottom: 42, height: 42, left: 0, right: 1_040, top: 0, width: 1_040 },
    titleBarNativeControlReserve: 152,
    visualViewportHeight: 800,
    visualViewportWidth: 1_040
  };
}
