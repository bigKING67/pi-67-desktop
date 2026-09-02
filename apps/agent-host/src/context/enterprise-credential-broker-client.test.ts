import type {
  EnterpriseCredentialClearRequest,
  EnterpriseCredentialStoreRequest
} from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";

const credential = {
  endpoint: "https://datahub.example.test",
  accessToken: "agent-access-token",
  accountId: "account-1",
  userId: "user-1",
  displayName: "Employee 67",
  expiresAt: 1_900_000_000_000
};

describe("EnterpriseCredentialBrokerClient", () => {
  it("updates its in-memory snapshot only after Main acknowledges secure persistence", async () => {
    const postMessage = vi.fn();
    const client = new EnterpriseCredentialBrokerClient({ postMessage });
    client.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available" });

    const storing = client.store(credential);
    const storeRequest = postMessage.mock.calls[0]?.[0] as EnterpriseCredentialStoreRequest;
    expect(storeRequest).toMatchObject({ type: "enterprise-credential-store", credential });
    expect(client.snapshot()).toEqual({ storage: "available" });
    expect(client.handleOperationResult({
      type: "enterprise-credential-operation-result",
      requestId: storeRequest.requestId,
      ok: true
    })).toBe(true);
    await expect(storing).resolves.toBeUndefined();
    expect(client.snapshot()).toEqual({ storage: "available", credential });

    const clearing = client.clear();
    const clearRequest = postMessage.mock.calls[1]?.[0] as EnterpriseCredentialClearRequest;
    expect(clearRequest.type).toBe("enterprise-credential-clear");
    client.handleOperationResult({
      type: "enterprise-credential-operation-result",
      requestId: clearRequest.requestId,
      ok: true
    });
    await expect(clearing).resolves.toBeUndefined();
    expect(client.snapshot()).toEqual({ storage: "available" });
  });

  it("fails enterprise persistence closed while leaving the Host process usable", async () => {
    const client = new EnterpriseCredentialBrokerClient({ postMessage: vi.fn() });
    client.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "unavailable" });

    await expect(client.store(credential)).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    await expect(client.clear()).resolves.toBeUndefined();
    expect(client.snapshot()).toEqual({ storage: "unavailable" });
    expect(client.handleOperationResult({
      type: "enterprise-credential-operation-result",
      requestId: "unknown-request",
      ok: true
    })).toBe(false);
  });
});
