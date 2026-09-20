import { randomUUID } from "node:crypto";
import type {
  EnterpriseAccessCredential,
  EnterpriseCredentialBootstrapMessage,
  EnterpriseCredentialClearRequest,
  EnterpriseCredentialOperationResult,
  EnterpriseCredentialStoreRequest,
  SharedKnowledgeReceiptRequest
} from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";

export interface EnterpriseCredentialParentPort {
  postMessage(message: EnterpriseCredentialStoreRequest | EnterpriseCredentialClearRequest | SharedKnowledgeReceiptRequest): void;
}

interface PendingOperation {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface EnterpriseCredentialSnapshot {
  storage: "unknown" | "available" | "unavailable";
  credential?: EnterpriseAccessCredential;
}

export class EnterpriseCredentialBrokerClient {
  readonly #pending = new Map<string, PendingOperation>();
  #snapshot: EnterpriseCredentialSnapshot = { storage: "unknown" };
  #receiptClient: SharedKnowledgeReceiptClient | undefined;
  #generation = 0;
  #stopped = false;
  #lifetime = new AbortController();

  constructor(
    private readonly parent: EnterpriseCredentialParentPort,
    private readonly timeoutMs = 5_000
  ) { this.#lifetime.abort(); }

  /** Retired before any credential replacement/clear; renewed only after acknowledgement. */
  get signal(): AbortSignal { return this.#lifetime.signal; }

  snapshot(): EnterpriseCredentialSnapshot {
    return {
      ...this.#snapshot,
      ...(this.#snapshot.credential === undefined
        ? {}
        : { credential: { ...this.#snapshot.credential } })
    };
  }

  applyBootstrap(message: EnterpriseCredentialBootstrapMessage): void {
    if (this.#stopped) return;
    this.#retireReceipts();
    this.#snapshot = {
      storage: message.storage,
      ...(message.credential === undefined ? {} : { credential: { ...message.credential } })
    };
    this.#startReceipts();
  }

  sharedKnowledgeReceipts(): SharedKnowledgeReceiptClient | undefined { return this.#receiptClient; }
  handleReceiptResult(message: unknown): boolean { return this.#receiptClient?.handleResult(message) ?? false; }

  handleOperationResult(message: EnterpriseCredentialOperationResult): boolean {
    const pending = this.#pending.get(message.requestId);
    if (!pending) return false;
    this.#pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve();
    else pending.reject(new HostCommandError(
      "RUNTIME_NOT_READY",
      message.errorCode === "SECURE_STORAGE_UNAVAILABLE"
        ? "System secure storage is unavailable; New Money sign-in was not retained."
        : "New Money sign-in could not be stored securely.",
      true
    ));
    return true;
  }

  async store(credential: EnterpriseAccessCredential): Promise<void> {
    this.#assertCurrent(this.#generation);
    if (this.#snapshot.storage !== "available") {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "System secure storage is unavailable; New Money sign-in is disabled.",
        true
      );
    }
    this.#retireReceipts();
    const generation = this.#generation, snapshot = { ...credential };
    const requestId = randomUUID();
    await this.#request(requestId, {
      type: "enterprise-credential-store",
      requestId,
      credential: snapshot
    });
    this.#assertCurrent(generation);
    this.#snapshot = { storage: "available", credential: snapshot };
    this.#startReceipts();
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const generation = this.#generation;
    this.#assertCurrent(generation);
    const credential = this.#snapshot.credential;
    if (!credential) throw new HostCommandError("RUNTIME_NOT_READY", "Sign in to New Money first.", true);
    const snapshot = { ...credential, displayName };
    const requestId = randomUUID();
    await this.#request(requestId, {
      type: "enterprise-credential-store", requestId, profileOnly: true, credential: snapshot
    });
    this.#assertCurrent(generation);
    this.#snapshot = { ...this.#snapshot, credential: snapshot };
  }

  async clear(): Promise<void> {
    this.#assertCurrent(this.#generation);
    this.#retireReceipts();
    const generation = this.#generation;
    if (this.#snapshot.storage === "unavailable") {
      this.#snapshot = { storage: "unavailable" };
      return;
    }
    const requestId = randomUUID();
    await this.#request(requestId, { type: "enterprise-credential-clear", requestId });
    this.#assertCurrent(generation);
    this.#snapshot = { storage: "available" };
  }

  shutdown(): void {
    this.#stopped = true;
    this.#retireReceipts();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new HostCommandError("CONNECTION_CLOSED", "Agent Host is shutting down.", true));
    }
    this.#pending.clear();
  }

  #retireReceipts(): void {
    this.#generation += 1;
    this.#lifetime.abort();
    this.#receiptClient?.shutdown();
    this.#receiptClient = undefined;
  }

  #startReceipts(): void {
    const credential = this.#snapshot.credential;
    if (this.#snapshot.storage === "available" && credential) {
      this.#lifetime = new AbortController();
      this.#receiptClient = new SharedKnowledgeReceiptClient(this.parent, {
        userId: credential.userId, endpoint: credential.endpoint
      });
    }
  }

  #assertCurrent(generation: number): void {
    if (this.#stopped || generation !== this.#generation) {
      throw new HostCommandError("CONNECTION_CLOSED", "New Money credential operation belongs to an obsolete lifecycle.", true);
    }
  }

  #request(
    requestId: string,
    message: EnterpriseCredentialStoreRequest | EnterpriseCredentialClearRequest
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new HostCommandError(
          "RUNTIME_NOT_READY",
          "System secure storage did not acknowledge the New Money credential operation.",
          true
        ));
      }, this.timeoutMs);
      timeout.unref?.();
      this.#pending.set(requestId, { resolve, reject, timeout });
      try {
        this.parent.postMessage(message);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("Credential broker request failed."));
      }
    });
  }
}
