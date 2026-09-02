import { randomUUID } from "node:crypto";
import type {
  EnterpriseAccessCredential,
  EnterpriseCredentialBootstrapMessage,
  EnterpriseCredentialClearRequest,
  EnterpriseCredentialOperationResult,
  EnterpriseCredentialStoreRequest
} from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

export interface EnterpriseCredentialParentPort {
  postMessage(message: EnterpriseCredentialStoreRequest | EnterpriseCredentialClearRequest): void;
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

  constructor(
    private readonly parent: EnterpriseCredentialParentPort,
    private readonly timeoutMs = 5_000
  ) {}

  snapshot(): EnterpriseCredentialSnapshot {
    return {
      ...this.#snapshot,
      ...(this.#snapshot.credential === undefined
        ? {}
        : { credential: { ...this.#snapshot.credential } })
    };
  }

  applyBootstrap(message: EnterpriseCredentialBootstrapMessage): void {
    this.#snapshot = {
      storage: message.storage,
      ...(message.credential === undefined ? {} : { credential: { ...message.credential } })
    };
  }

  handleOperationResult(message: EnterpriseCredentialOperationResult): boolean {
    const pending = this.#pending.get(message.requestId);
    if (!pending) return false;
    this.#pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve();
    else pending.reject(new HostCommandError(
      "RUNTIME_NOT_READY",
      message.errorCode === "SECURE_STORAGE_UNAVAILABLE"
        ? "System secure storage is unavailable; enterprise sign-in was not retained."
        : "Enterprise sign-in could not be stored securely.",
      true
    ));
    return true;
  }

  async store(credential: EnterpriseAccessCredential): Promise<void> {
    if (this.#snapshot.storage !== "available") {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "System secure storage is unavailable; enterprise sign-in is disabled.",
        true
      );
    }
    const requestId = randomUUID();
    await this.#request(requestId, {
      type: "enterprise-credential-store",
      requestId,
      credential
    });
    this.#snapshot = { storage: "available", credential: { ...credential } };
  }

  async clear(): Promise<void> {
    if (this.#snapshot.storage === "unavailable") {
      this.#snapshot = { storage: "unavailable" };
      return;
    }
    const requestId = randomUUID();
    await this.#request(requestId, { type: "enterprise-credential-clear", requestId });
    this.#snapshot = { storage: "available" };
  }

  shutdown(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new HostCommandError("CONNECTION_CLOSED", "Agent Host is shutting down.", true));
    }
    this.#pending.clear();
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
          "System secure storage did not acknowledge the enterprise credential operation.",
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
