import {
  isEnterpriseCredentialClearRequest,
  isEnterpriseCredentialStoreRequest,
  isSharedKnowledgeReceiptRequest,
  type SharedKnowledgeReceiptRequest,
  type SharedKnowledgeReceiptResult,
  type EnterpriseAccessCredential,
  type EnterpriseCredentialBootstrapMessage,
  type EnterpriseCredentialOperationResult
} from "@pi67/protocol";
import { SharedKnowledgeReceiptBinding, type SharedKnowledgeReceiptOwner } from "./shared-knowledge-receipt-binding.js";
import { bindSharedKnowledgeOwner } from "./shared-knowledge-owner.js";

export interface SharedKnowledgeReceiptPort {
  operation(message: unknown): Promise<SharedKnowledgeReceiptResult> | undefined;
  invalidate(): void;
}

export interface EnterpriseCredentialBrokerPort {
  load(): Promise<{
    storage: "available" | "unavailable";
    credential?: EnterpriseAccessCredential;
  }>;
  store(credential: EnterpriseAccessCredential): Promise<void>;
  updateDisplayName?(credential: EnterpriseAccessCredential): Promise<void>;
  clear(): Promise<void>;
}

export class EnterpriseCredentialSupervisor {
  #receiptGeneration = 0;
  #receiptIdentity: Readonly<Pick<EnterpriseAccessCredential, "endpoint" | "userId">> | undefined;
  readonly #receiptBindings = new Set<SharedKnowledgeReceiptBinding>();

  constructor(
    private readonly getBroker: () => EnterpriseCredentialBrokerPort | undefined,
    private readonly getReceipts: () => SharedKnowledgeReceiptPort | undefined = () => undefined
  ) {}

  requiresBootstrap(): boolean {
    return this.getBroker() !== undefined;
  }

  /** Main-only factory: root/profile/scope must come from Main state, not raw IPC.
   * User and service are copied from the successful credential lifecycle, never
   * supplied by the caller. Scope membership/permission still require validation. */
  createReceiptBinding(root: string, localProfileId: string, scope: Pick<SharedKnowledgeReceiptOwner, "teamId" | "scopeKind" | "scopeId">) {
    if (!this.#receiptIdentity || this.#receiptBindings.size >= 128) {
      throw new Error("Shared receipt binding creation unavailable.");
    }
    const { owner } = bindSharedKnowledgeOwner({
      localProfileId, endpoint: this.#receiptIdentity.endpoint, userId: this.#receiptIdentity.userId,
      teamId: scope.teamId, scopeKind: scope.scopeKind, scopeId: scope.scopeId
    });
    const binding = new SharedKnowledgeReceiptBinding(root, owner);
    const generation = this.#receiptGeneration, identity = this.#receiptIdentity;
    let released = false;
    this.#receiptBindings.add(binding);
    return { binding, identity, owner, isCurrent: () => !released && generation === this.#receiptGeneration,
      release: () => { released = true; this.#receiptBindings.delete(binding); binding.retire(); } };
  }

  invalidateReceiptBindings(): void {
    this.#receiptGeneration += 1;
    this.#receiptIdentity = undefined;
    for (const binding of this.#receiptBindings) binding.retire();
    this.#receiptBindings.clear();
    this.getReceipts()?.invalidate();
  }

  async bootstrapMessage(): Promise<EnterpriseCredentialBootstrapMessage> {
    this.invalidateReceiptBindings();
    const generation = this.#receiptGeneration;
    const broker = this.getBroker();
    try {
      const snapshot = broker === undefined
        ? { storage: "unavailable" as const }
        : await broker.load();
      if (generation === this.#receiptGeneration) {
        this.#receiptIdentity = snapshot.storage === "available" && snapshot.credential !== undefined
          ? receiptIdentity(snapshot.credential) : undefined;
      }
      return {
        type: "enterprise-credential-bootstrap",
        storage: snapshot.storage,
        ...(snapshot.credential === undefined ? {} : { credential: snapshot.credential })
      };
    } catch {
      return { type: "enterprise-credential-bootstrap", storage: "unavailable" };
    }
  }

  operation(message: unknown): Promise<EnterpriseCredentialOperationResult | SharedKnowledgeReceiptResult> | undefined {
    if (isSharedKnowledgeReceiptRequest(message)) return this.#receiptOperation(message);
    if (isEnterpriseCredentialStoreRequest(message)) {
      if (message.profileOnly) return this.updateDisplayName(message.requestId, message.credential);
      return this.store(message.requestId, message.credential);
    }
    if (isEnterpriseCredentialClearRequest(message)) return this.clear(message.requestId);
    return undefined;
  }

  async #receiptOperation(message: SharedKnowledgeReceiptRequest): Promise<SharedKnowledgeReceiptResult> {
    const generation = this.#receiptGeneration;
    const failure = (errorCode: Extract<SharedKnowledgeReceiptResult, { ok: false }>["errorCode"]): SharedKnowledgeReceiptResult =>
      ({ type: `${message.type}-result`, requestId: message.requestId, ok: false, errorCode });
    if (!this.#receiptIdentity) return failure("NOT_SIGNED_IN");
    try {
      const receipts = this.getReceipts();
      if (!receipts) return failure("SCOPE_DENIED");
      const result = await receipts.operation(message);
      if (generation !== this.#receiptGeneration) return failure("STALE_HANDLE");
      return result ?? failure("PERSISTENCE_FAILED");
    } catch {
      return failure(generation === this.#receiptGeneration ? "PERSISTENCE_FAILED" : "STALE_HANDLE");
    }
  }

  private async updateDisplayName(requestId: string, credential: EnterpriseAccessCredential): Promise<EnterpriseCredentialOperationResult> {
    const generation = this.#receiptGeneration;
    try {
      const broker = this.getBroker();
      if (!broker?.updateDisplayName || !this.#receiptIdentity
        || this.#receiptIdentity.endpoint !== credential.endpoint || this.#receiptIdentity.userId !== credential.userId) {
        throw new Error("New Money profile unavailable.");
      }
      await broker.updateDisplayName(credential);
      if (generation !== this.#receiptGeneration) throw new Error("New Money profile superseded.");
      return { type: "enterprise-credential-operation-result", requestId, ok: true };
    } catch (error) { return failure(requestId, error); }
  }

  private async store(
    requestId: string,
    credential: EnterpriseAccessCredential
  ): Promise<EnterpriseCredentialOperationResult> {
    this.invalidateReceiptBindings();
    const generation = this.#receiptGeneration;
    const snapshot = { ...credential };
    const identity = receiptIdentity(snapshot);
    try {
      const broker = this.getBroker();
      if (!broker) throw new Error("secure storage is unavailable");
      await broker.store(snapshot);
      if (generation === this.#receiptGeneration) this.#receiptIdentity = identity;
      return { type: "enterprise-credential-operation-result", requestId, ok: true };
    } catch (error) {
      return failure(requestId, error);
    }
  }

  private async clear(requestId: string): Promise<EnterpriseCredentialOperationResult> {
    this.invalidateReceiptBindings();
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

function receiptIdentity(credential: EnterpriseAccessCredential): Readonly<Pick<EnterpriseAccessCredential, "endpoint" | "userId">> {
  return Object.freeze({ endpoint: credential.endpoint, userId: credential.userId });
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
