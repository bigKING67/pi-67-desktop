import { link, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PackageMutationReceiptStore,
  PackageMutationReplayConflictError,
  type ExtensionPackageObservation
} from "./package-mutation-receipt-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PackageMutationReceiptStore", () => {
  it("persists redacted active receipts without raw sources, paths, or mutation keys", async () => {
    const fixture = await receiptFixture();
    const source = "git+https://token@example.invalid/private/package.git";
    await fixture.store.reserve({
      source,
      scope: "project",
      sourceKind: "git",
      operation: "install",
      idempotencyKey: "install-secret-idempotency-key",
      fingerprint: "workspace/private/source"
    });
    await fixture.store.markMutating(source, "project", "install-secret-idempotency-key");
    await fixture.store.commitActive(
      source,
      "project",
      "install-secret-idempotency-key",
      observation(),
      true
    );

    expect(fixture.store.read(source, "project")).toMatchObject({
      status: "found",
      record: {
        state: "active",
        lastOperation: "install",
        changed: true,
        observation: observation()
      }
    });
    const ledger = await ledgerContent(fixture.storageRoot);
    expect(ledger).not.toContain(source);
    expect(ledger).not.toContain("token@example.invalid");
    expect(ledger).not.toContain("install-secret-idempotency-key");
    expect(ledger).not.toContain(fixture.cwd);
    expect(ledger).not.toContain(fixture.agentDir);
    const path = await ledgerPath(fixture.storageRoot);
    if (process.platform !== "win32") expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects durable ledgers that add raw source, path, token, or observation fields", async () => {
    const fixture = await receiptFixture();
    const source = "npm:@example/pi-extension";
    await fixture.store.reserve({
      source,
      scope: "global",
      sourceKind: "npm",
      operation: "install",
      idempotencyKey: "strict-ledger",
      fingerprint: "strict-ledger"
    });
    await fixture.store.markMutating(source, "global", "strict-ledger");
    await fixture.store.commitActive(source, "global", "strict-ledger", observation(), true);

    const path = await ledgerPath(fixture.storageRoot);
    const original = JSON.parse(await readFile(path, "utf8")) as {
      records: Array<Record<string, unknown>>;
    };
    const leakedRecord = structuredClone(original);
    Object.assign(leakedRecord.records[0]!, {
      rawSource: source,
      rawPath: fixture.cwd,
      token: "secret"
    });
    await writeFile(path, `${JSON.stringify(leakedRecord)}\n`);
    expect(fixture.store.read(source, "global")).toEqual({ status: "invalid" });

    const leakedObservation = structuredClone(original);
    Object.assign(leakedObservation.records[0]!.observation as Record<string, unknown>, {
      token: "secret"
    });
    await writeFile(path, `${JSON.stringify(leakedObservation)}\n`);
    expect(fixture.store.read(source, "global")).toEqual({ status: "invalid" });
  });

  it("replays the same durable mutation and rejects key reuse with another fingerprint", async () => {
    const fixture = await receiptFixture();
    const input = {
      source: "npm:@example/pi-extension",
      scope: "global" as const,
      sourceKind: "npm" as const,
      operation: "update" as const,
      idempotencyKey: "stable-update",
      fingerprint: "fingerprint-a"
    };
    await expect(fixture.store.reserve(input)).resolves.toMatchObject({ status: "reserved" });
    await expect(fixture.store.reserve(input)).resolves.toMatchObject({ status: "replay" });
    await expect(fixture.store.reserve({ ...input, fingerprint: "fingerprint-b" }))
      .rejects.toBeInstanceOf(PackageMutationReplayConflictError);
    await expect(fixture.store.reserve({
      ...input,
      source: "npm:@example/another-extension",
      fingerprint: "fingerprint-a"
    })).rejects.toBeInstanceOf(PackageMutationReplayConflictError);
  });

  it("serializes concurrent owner mutations without dropping records", async () => {
    const fixture = await receiptFixture();
    await Promise.all(Array.from({ length: 12 }, (_, index) => fixture.store.reserve({
      source: `npm:package-${index}`,
      scope: "global",
      sourceKind: "npm",
      operation: "install",
      idempotencyKey: `mutation-${index}`,
      fingerprint: `fingerprint-${index}`
    })));
    for (let index = 0; index < 12; index += 1) {
      expect(fixture.store.read(`npm:package-${index}`, "global").status).toBe("found");
    }
  });

  it("fails closed for disabled, corrupt, future-version, symlink, and hardlink ledgers", async () => {
    const fixture = await receiptFixture();
    expect(new PackageMutationReceiptStore({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir
    }).read("npm:missing", "global")).toEqual({ status: "invalid" });

    await fixture.store.reserve({
      source: "npm:unsafe",
      scope: "global",
      sourceKind: "npm",
      operation: "install",
      idempotencyKey: "unsafe",
      fingerprint: "unsafe"
    });
    const path = await ledgerPath(fixture.storageRoot);
    await writeFile(path, "not-json\n");
    expect(fixture.store.read("npm:unsafe", "global")).toEqual({ status: "invalid" });

    await writeFile(path, JSON.stringify({ version: 2, ownerKey: "x", records: [] }));
    expect(fixture.store.read("npm:unsafe", "global")).toEqual({ status: "invalid" });

    const outside = join(fixture.storageRoot, "outside.json");
    await writeFile(outside, "{}\n");
    await rm(path);
    await symlink(outside, path);
    expect(fixture.store.read("npm:unsafe", "global")).toEqual({ status: "invalid" });

    await rm(path);
    await link(outside, path);
    expect(fixture.store.read("npm:unsafe", "global")).toEqual({ status: "invalid" });
  });
});

async function receiptFixture() {
  const storageRoot = await mkdtemp(join(tmpdir(), "pi67-package-receipts-"));
  roots.push(storageRoot);
  const cwd = join(storageRoot, "workspace-private");
  const agentDir = join(storageRoot, "agent-private");
  return {
    storageRoot,
    cwd,
    agentDir,
    store: new PackageMutationReceiptStore({ cwd, agentDir, storageRoot, now: () => 1_786_000_000_000 })
  };
}

function observation(): ExtensionPackageObservation {
  return {
    packageName: "@example/pi-extension",
    packageVersion: "1.2.3",
    manifestSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
    directoryIdentityDigest: "c".repeat(64),
    observedAt: 1_786_000_000_000
  };
}

async function ledgerPath(storageRoot: string): Promise<string> {
  const directory = join(storageRoot, "package-mutation-receipts-v1");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  expect(names).toHaveLength(1);
  return join(directory, names[0]!);
}

async function ledgerContent(storageRoot: string): Promise<string> {
  return readFile(await ledgerPath(storageRoot), "utf8");
}
