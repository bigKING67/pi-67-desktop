import { describe, expect, it, vi } from "vitest";
import {
  EnterpriseCredentialSupervisor,
  type EnterpriseCredentialBrokerPort
} from "./enterprise-credential-supervisor.js";

const credential = {
  endpoint: "https://datahub.example.test",
  accessToken: "short-lived-token",
  accountId: "account-1",
  userId: "user-1",
  displayName: "Employee 67",
  expiresAt: 1_800_000_000_000
};

function broker(overrides: Partial<EnterpriseCredentialBrokerPort> = {}): EnterpriseCredentialBrokerPort {
  return {
    load: vi.fn().mockResolvedValue({ storage: "available" }),
    store: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("EnterpriseCredentialSupervisor", () => {
  it("reports unavailable storage and ignores unrelated parent messages without a broker", async () => {
    const supervisor = new EnterpriseCredentialSupervisor(() => undefined);
    expect(supervisor.requiresBootstrap()).toBe(false);
    await expect(supervisor.bootstrapMessage()).resolves.toEqual({
      type: "enterprise-credential-bootstrap",
      storage: "unavailable"
    });
    expect(supervisor.operation({ type: "unrelated" })).toBeUndefined();
  });

  it("bootstraps an available credential without exposing broker details", async () => {
    const credentialBroker = broker({
      load: vi.fn().mockResolvedValue({ storage: "available", credential })
    });
    const supervisor = new EnterpriseCredentialSupervisor(() => credentialBroker);
    expect(supervisor.requiresBootstrap()).toBe(true);
    await expect(supervisor.bootstrapMessage()).resolves.toEqual({
      type: "enterprise-credential-bootstrap",
      storage: "available",
      credential
    });
  });

  it("fails bootstrap closed when credential loading fails", async () => {
    const supervisor = new EnterpriseCredentialSupervisor(() => broker({
      load: vi.fn().mockRejectedValue(new Error("corrupt encrypted payload"))
    }));
    await expect(supervisor.bootstrapMessage()).resolves.toEqual({
      type: "enterprise-credential-bootstrap",
      storage: "unavailable"
    });
  });

  it("stores and clears valid credential requests through the secure broker", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const credentialBroker = broker({ store, clear });
    const supervisor = new EnterpriseCredentialSupervisor(() => credentialBroker);
    await expect(supervisor.operation({
      type: "enterprise-credential-store",
      requestId: "store-1",
      credential
    })).resolves.toEqual({
      type: "enterprise-credential-operation-result",
      requestId: "store-1",
      ok: true
    });
    await expect(supervisor.operation({
      type: "enterprise-credential-clear",
      requestId: "clear-1"
    })).resolves.toEqual({
      type: "enterprise-credential-operation-result",
      requestId: "clear-1",
      ok: true
    });
    expect(store).toHaveBeenCalledWith(credential);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("returns a specific fail-closed code when secure storage is absent", async () => {
    const supervisor = new EnterpriseCredentialSupervisor(() => undefined);
    await expect(supervisor.operation({
      type: "enterprise-credential-store",
      requestId: "store-2",
      credential
    })).resolves.toMatchObject({
      requestId: "store-2",
      ok: false,
      errorCode: "SECURE_STORAGE_UNAVAILABLE"
    });
    await expect(supervisor.operation({
      type: "enterprise-credential-clear",
      requestId: "clear-2"
    })).resolves.toMatchObject({
      requestId: "clear-2",
      ok: false,
      errorCode: "SECURE_STORAGE_UNAVAILABLE"
    });
  });

  it("distinguishes unavailable secure storage from other persistence failures", async () => {
    const credentialBroker = broker({
      store: vi.fn().mockRejectedValue(new Error("secure storage is unavailable")),
      clear: vi.fn().mockRejectedValue("disk failure")
    });
    const supervisor = new EnterpriseCredentialSupervisor(() => credentialBroker);
    await expect(supervisor.operation({
      type: "enterprise-credential-store",
      requestId: "store-3",
      credential
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "SECURE_STORAGE_UNAVAILABLE"
    });
    await expect(supervisor.operation({
      type: "enterprise-credential-clear",
      requestId: "clear-3"
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "PERSISTENCE_FAILED"
    });
  });
});
