import type { DesktopTextEncryption } from "./desktop-text-encryption.js";

export type DesktopSafeStorageAccess = "available" | "unavailable";

export interface DesktopSafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

type DesktopSafeStorageState = "unknown" | DesktopSafeStorageAccess | "blocked";

const ACCESS_PROBE = "pi67-safe-storage-access-probe-v1";

/**
 * Owns the process-wide safe-storage circuit breaker. A failed OS credential
 * access is retried only by ensureAvailable(), which is called from an explicit
 * renderer action; background persistence observes unavailable without probing
 * the OS again.
 */
export class DesktopSafeStorage implements DesktopTextEncryption {
  readonly #backend: DesktopSafeStorageBackend;
  #state: DesktopSafeStorageState = "unknown";

  constructor(backend: DesktopSafeStorageBackend) {
    this.#backend = backend;
  }

  isAvailable(): boolean {
    if (this.#state === "available") return true;
    if (this.#state === "unavailable" || this.#state === "blocked") return false;
    try {
      if (!this.#backend.isEncryptionAvailable()) {
        this.#state = "unavailable";
        return false;
      }
      return true;
    } catch {
      this.#state = "blocked";
      return false;
    }
  }

  encrypt(value: string): Buffer {
    if (!this.isAvailable()) throw unavailableError();
    try {
      const encrypted = this.#backend.encryptString(value);
      this.#state = "available";
      return encrypted;
    } catch {
      this.#state = "blocked";
      throw unavailableError();
    }
  }

  decrypt(value: Buffer): string {
    if (!this.isAvailable()) throw unavailableError();
    try {
      const decrypted = this.#backend.decryptString(value);
      this.#state = "available";
      return decrypted;
    } catch {
      this.#state = "blocked";
      throw unavailableError();
    }
  }

  ensureAvailable(): DesktopSafeStorageAccess {
    if (this.#state === "available") return "available";
    this.#state = "unknown";
    if (!this.isAvailable()) return "unavailable";
    try {
      const encrypted = this.#backend.encryptString(ACCESS_PROBE);
      if (this.#backend.decryptString(encrypted) !== ACCESS_PROBE) {
        this.#state = "blocked";
        return "unavailable";
      }
      this.#state = "available";
      return "available";
    } catch {
      this.#state = "blocked";
      return "unavailable";
    }
  }
}

function unavailableError(): Error {
  return new Error("System secure storage is unavailable.");
}
