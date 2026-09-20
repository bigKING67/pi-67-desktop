import { expect, it } from "vitest";
import { isLocalMemoryActivationSnapshot, isLocalMemoryHealthCheck, parseLocalMemoryActivationRequest } from "./local-memory-activation.js";
const snapshot = { available: true, preference: "disabled", selectedAtLaunch: false, restartRequired: false, lifecycle: "idle", issue: "none", busy: false };
it("keeps activation requests boolean-only and status secret-free", () => {
  expect(parseLocalMemoryActivationRequest({ enabled: true })).toEqual({ enabled: true });
  for (const value of [true, null, {}, { enabled: 1 }, { enabled: true, runtime: "/foreign" }]) {
    expect(parseLocalMemoryActivationRequest(value)).toBeUndefined();
  }
  expect(isLocalMemoryActivationSnapshot(snapshot)).toBe(true);
  expect(isLocalMemoryActivationSnapshot({ available: false })).toBe(true);
  for (const value of [{ ...snapshot, apiKey: "synthetic" }, { ...snapshot, lifecycle: "ready" },
    { ...snapshot, issue: "raw-native-error" }, { ...snapshot, preference: true }, { available: false, preference: "enabled" }]) {
    expect(isLocalMemoryActivationSnapshot(value)).toBe(false);
  }
});
it("limits health readback to fixed outcomes and a secret-free activation snapshot", () => {
  for (const health of ["healthy", "unavailable", "not-running"]) {
    expect(isLocalMemoryHealthCheck({ activation: snapshot, health })).toBe(true);
  }
  expect(isLocalMemoryHealthCheck({ activation: snapshot, health: "healthy", endpoint: "http://private" })).toBe(false);
  expect(isLocalMemoryHealthCheck({ activation: { ...snapshot, apiKey: "secret" }, health: "healthy" })).toBe(false);
  expect(isLocalMemoryHealthCheck({ activation: snapshot, health: "raw-error" })).toBe(false);
});
