import { describe, expect, it } from "vitest";
import { DesktopSafeStorage, type DesktopSafeStorageBackend } from "./desktop-safe-storage.js";

describe("DesktopSafeStorage", () => {
  it("opens the circuit after an OS credential failure and retries only explicitly", () => {
    let blocked = true;
    let availabilityCalls = 0;
    let encryptionCalls = 0;
    const backend: DesktopSafeStorageBackend = {
      isEncryptionAvailable: () => {
        availabilityCalls += 1;
        return true;
      },
      encryptString: (value) => {
        encryptionCalls += 1;
        if (blocked) throw new Error("credential access denied");
        return Buffer.from(`encrypted:${value}`, "utf8");
      },
      decryptString: (value) => value.toString("utf8").replace(/^encrypted:/u, "")
    };
    const storage = new DesktopSafeStorage(backend);

    expect(() => storage.encrypt("draft")).toThrow("System secure storage is unavailable.");
    expect(storage.isAvailable()).toBe(false);
    expect(availabilityCalls).toBe(1);
    expect(encryptionCalls).toBe(1);

    blocked = false;
    expect(storage.isAvailable()).toBe(false);
    expect(storage.ensureAvailable()).toBe("available");
    expect(storage.encrypt("draft").toString("utf8")).toBe("encrypted:draft");
    expect(availabilityCalls).toBe(2);
  });

  it("returns unavailable without calling encryption when the platform reports no secure storage", () => {
    let encryptionCalls = 0;
    const backend: DesktopSafeStorageBackend = {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        encryptionCalls += 1;
        return Buffer.alloc(0);
      },
      decryptString: () => ""
    };
    const storage = new DesktopSafeStorage(backend);

    expect(storage.ensureAvailable()).toBe("unavailable");
    expect(encryptionCalls).toBe(0);
    expect(storage.isAvailable()).toBe(false);
  });

  it("rejects a probe that cannot be decrypted exactly", () => {
    const backend: DesktopSafeStorageBackend = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: () => "different value"
    };
    const storage = new DesktopSafeStorage(backend);

    expect(storage.ensureAvailable()).toBe("unavailable");
    expect(storage.isAvailable()).toBe(false);
  });
});
