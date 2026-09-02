import {
  isEnterpriseCredentialClearRequest,
  isEnterpriseCredentialStoreRequest,
  type EnterpriseAccessCredential,
  type EnterpriseCredentialBootstrapMessage,
  type EnterpriseCredentialOperationResult
} from "@pi67/protocol";

export interface EnterpriseCredentialBrokerPort {
  load(): Promise<{
    storage: "available" | "unavailable";
    credential?: EnterpriseAccessCredential;
  }>;
  store(credential: EnterpriseAccessCredential): Promise<void>;
  clear(): Promise<void>;
}

export class EnterpriseCredentialSupervisor {
  constructor(
    private readonly getBroker: () => EnterpriseCredentialBrokerPort | undefined
  ) {}

  requiresBootstrap(): boolean {
    return this.getBroker() !== undefined;
  }

  async bootstrapMessage(): Promise<EnterpriseCredentialBootstrapMessage> {
    const broker = this.getBroker();
    try {
      const snapshot = broker === undefined
        ? { storage: "unavailable" as const }
        : await broker.load();
      return {
        type: "enterprise-credential-bootstrap",
        storage: snapshot.storage,
        ...(snapshot.credential === undefined ? {} : { credential: snapshot.credential })
      };
    } catch {
      return { type: "enterprise-credential-bootstrap", storage: "unavailable" };
    }
  }

  operation(message: unknown): Promise<EnterpriseCredentialOperationResult> | undefined {
    if (isEnterpriseCredentialStoreRequest(message)) {
      return this.store(message.requestId, message.credential);
    }
    if (isEnterpriseCredentialClearRequest(message)) return this.clear(message.requestId);
    return undefined;
  }

  private async store(
    requestId: string,
    credential: EnterpriseAccessCredential
  ): Promise<EnterpriseCredentialOperationResult> {
    try {
      const broker = this.getBroker();
      if (!broker) throw new Error("secure storage is unavailable");
      await broker.store(credential);
      return { type: "enterprise-credential-operation-result", requestId, ok: true };
    } catch (error) {
      return failure(requestId, error);
    }
  }

  private async clear(requestId: string): Promise<EnterpriseCredentialOperationResult> {
    try {
      const broker = this.getBroker();
      if (!broker) throw new Error("secure storage is unavailable");
      await broker.clear();
      return { type: "enterprise-credential-operation-result", requestId, ok: true };
    } catch (error) {
      return failure(requestId, error);
    }
  }
}

function failure(requestId: string, error: unknown): EnterpriseCredentialOperationResult {
  return {
    type: "enterprise-credential-operation-result",
    requestId,
    ok: false,
    errorCode: error instanceof Error && /secure storage is unavailable/iu.test(error.message)
      ? "SECURE_STORAGE_UNAVAILABLE"
      : "PERSISTENCE_FAILED"
  };
}
