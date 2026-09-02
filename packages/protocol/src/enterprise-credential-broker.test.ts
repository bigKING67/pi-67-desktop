import { describe, expect, it } from "vitest";
import {
  isEnterpriseCredentialBootstrapMessage,
  isEnterpriseCredentialClearRequest,
  isEnterpriseCredentialOperationResult,
  isEnterpriseCredentialStoreRequest
} from "./enterprise-credential-broker.js";

const credential = {
  endpoint: "https://datahub.example.test",
  accessToken: "short-lived-token",
  accountId: "account-1",
  userId: "user-1",
  displayName: "Employee 67",
  expiresAt: 1_800_000_000_000
};

describe("enterprise credential broker protocol", () => {
  it("accepts exact bounded credential messages", () => {
    expect(isEnterpriseCredentialBootstrapMessage({
      type: "enterprise-credential-bootstrap",
      storage: "available",
      credential
    })).toBe(true);
    expect(isEnterpriseCredentialStoreRequest({
      type: "enterprise-credential-store",
      requestId: "request-1",
      credential
    })).toBe(true);
    expect(isEnterpriseCredentialClearRequest({
      type: "enterprise-credential-clear",
      requestId: "request-2"
    })).toBe(true);
    expect(isEnterpriseCredentialOperationResult({
      type: "enterprise-credential-operation-result",
      requestId: "request-1",
      ok: true
    })).toBe(true);
  });

  it("rejects unknown fields and unbounded secrets", () => {
    expect(isEnterpriseCredentialStoreRequest({
      type: "enterprise-credential-store",
      requestId: "request-1",
      credential: { ...credential, accessToken: "x".repeat(16_385) }
    })).toBe(false);
    expect(isEnterpriseCredentialBootstrapMessage({
      type: "enterprise-credential-bootstrap",
      storage: "available",
      credential,
      rawSession: "forbidden"
    })).toBe(false);
  });
});
