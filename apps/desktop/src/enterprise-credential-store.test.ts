import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnterpriseCredentialStore } from "./enterprise-credential-store.js";

const roots: string[] = [];
const credential = {
  endpoint: "https://datahub.example.test",
  accessToken: "short-lived-token",
  accountId: "account-1",
  userId: "user-1",
  displayName: "Employee 67",
  expiresAt: 1_800_000_000_000
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("EnterpriseCredentialStore", () => {
  it("rejects invalid Electron userData roots", () => {
    const encryption = {
      isAvailable: () => true,
      encrypt: (value: string) => Buffer.from(value, "utf8"),
      decrypt: (value: Buffer) => value.toString("utf8")
    };
    expect(() => new EnterpriseCredentialStore("", { encryption })).toThrow(/userData path is invalid/u);
    expect(() => new EnterpriseCredentialStore("invalid\0path", { encryption }))
      .toThrow(/userData path is invalid/u);
  });

  it("persists only encrypted credential bytes and restores the typed value", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-enterprise-credential-"));
    roots.push(root);
    const encryption = {
      isAvailable: () => true,
      encrypt: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decrypt: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/u, "")
    };
    const store = new EnterpriseCredentialStore(root, { encryption });
    await store.store(credential);
    const raw = await readFile(store.path, "utf8");
    expect(raw).not.toContain(credential.accessToken);
    await expect(store.load()).resolves.toEqual({ storage: "available", credential });
    await store.clear();
    await expect(store.load()).resolves.toEqual({ storage: "available" });
  });

  it("fails closed when system encryption is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-enterprise-credential-"));
    roots.push(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(
      join(root, "runtime", "enterprise-context-credential-v1.json"),
      `${JSON.stringify({ version: 1, encryptedCredential: "e30=" })}\n`,
      "utf8"
    );
    const store = new EnterpriseCredentialStore(root, {
      encryption: {
        isAvailable: () => false,
        encrypt: () => { throw new Error("unavailable"); },
        decrypt: () => { throw new Error("unavailable"); }
      }
    });
    await expect(store.load()).resolves.toEqual({ storage: "unavailable" });
    await expect(store.store(credential)).rejects.toThrow(/secure storage is unavailable/u);
  });

  it("does not probe OS encryption when no enterprise credential exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-enterprise-credential-"));
    roots.push(root);
    const isAvailable = vi.fn(() => true);
    const store = new EnterpriseCredentialStore(root, {
      encryption: {
        isAvailable,
        encrypt: (value: string) => Buffer.from(value, "utf8"),
        decrypt: (value: Buffer) => value.toString("utf8")
      }
    });

    await expect(store.load()).resolves.toEqual({ storage: "available" });
    expect(isAvailable).not.toHaveBeenCalled();
  });

  it("does not follow a substituted credential-directory symlink", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "pi67-enterprise-credential-"));
    const outside = await mkdtemp(join(tmpdir(), "pi67-enterprise-outside-"));
    roots.push(root, outside);
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "enterprise-context-credential-v1.json"), "preserve", "utf8");
    await symlink(outside, join(root, "runtime"), "dir");
    const store = new EnterpriseCredentialStore(root, {
      encryption: {
        isAvailable: () => true,
        encrypt: (value: string) => Buffer.from(value, "utf8"),
        decrypt: (value: Buffer) => value.toString("utf8")
      }
    });

    await expect(store.load()).resolves.toEqual({ storage: "unavailable" });
    await expect(store.store(credential)).rejects.toThrow(/safe local directory/u);
    await expect(store.clear()).rejects.toThrow(/safe local directory/u);
    await expect(readFile(join(outside, "enterprise-context-credential-v1.json"), "utf8"))
      .resolves.toBe("preserve");
  });

  it("treats malformed or oversized persisted payloads as absent credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-enterprise-credential-"));
    roots.push(root);
    const store = new EnterpriseCredentialStore(root, {
      encryption: {
        isAvailable: () => true,
        encrypt: (value: string) => Buffer.from(value, "utf8"),
        decrypt: (value: Buffer) => value.toString("utf8")
      }
    });
    await mkdir(join(root, "runtime"), { recursive: true });
    const malformedPayloads = [
      "not-json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ version: 2, encryptedCredential: "e30=" }),
      JSON.stringify({ version: 1, encryptedCredential: 42 }),
      JSON.stringify({ version: 1, encryptedCredential: "e30=", extra: true }),
      JSON.stringify({ version: 1, encryptedCredential: "e30=" })
    ];
    for (const payload of malformedPayloads) {
      await writeFile(store.path, payload, "utf8");
      await expect(store.load()).resolves.toEqual({ storage: "available" });
    }
    await writeFile(store.path, "x".repeat(32 * 1_024 + 1), "utf8");
    await expect(store.load()).resolves.toEqual({ storage: "available" });
  });

  it("rejects invalid and oversized credential writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-enterprise-credential-"));
    roots.push(root);
    const store = new EnterpriseCredentialStore(root, {
      encryption: {
        isAvailable: () => true,
        encrypt: () => Buffer.alloc(32 * 1_024),
        decrypt: (value: Buffer) => value.toString("utf8")
      }
    });
    await expect(store.store({ ...credential, expiresAt: -1 })).rejects.toThrow(/credential is invalid/u);
    await expect(store.store(credential)).rejects.toThrow(/persistence size limit/u);
  });
});
