import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { PackageMutationReceiptStore } from "./package-mutation-receipt-store.js";
import { packageSourceKind, PackageTrustRegistry } from "./package-trust-registry.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PackageTrustRegistry", () => {
  it("classifies bounded HTTP(S) and git-prefixed package sources as Git", () => {
    expect(packageSourceKind("https://gitlab.example.test/team/pi-extension")).toBe("git");
    expect(packageSourceKind("git:gitlab.example.test/team/pi-extension")).toBe("git");
    expect(packageSourceKind("npm:@example/pi-extension")).toBe("npm");
  });

  it("promotes only a matching durable observation and demotes content drift", async () => {
    const fixture = await trustFixture();
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "unverified",
      trustReason: "receipt-missing"
    });
    const observed = fixture.registry.observationFor(fixture.source, "global");
    expect(observed?.status).toBe("observed");
    if (observed?.status !== "observed") throw new Error("expected observation");

    await fixture.receipts.reserve({
      source: fixture.source,
      scope: "global",
      sourceKind: "npm",
      operation: "install",
      idempotencyKey: "install-1",
      fingerprint: "install-1"
    });
    await fixture.receipts.markMutating(fixture.source, "global", "install-1");
    await fixture.receipts.commitActive(
      fixture.source,
      "global",
      "install-1",
      observed.observation,
      true
    );
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "user-installed-observed",
      manifestSha256: observed.observation.manifestSha256,
      contentSha256: observed.observation.contentSha256
    });
    expect(fixture.registry.runtimePackageAllowed(fixture.source, "global")).toBe(true);

    await writeFile(join(fixture.packageRoot, "index.js"), "export default 'changed';\n");
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "drifted",
      trustReason: "content-hash-changed"
    });
    expect(fixture.registry.runtimePackageAllowed(fixture.source, "global")).toBe(false);
  });

  it("admits exact Pi-67 baselines and content-bound user approvals without conflating them", async () => {
    const fixture = await trustFixture();
    await fixture.registry.refresh();
    const observed = fixture.registry.observationFor(fixture.source, "global");
    if (observed?.status !== "observed") throw new Error("expected observation");
    expect(observed.baselineContentSha256)
      .toBe("9237bc90b8761ffbcffc441acd358c5a2fb1680ce58b56f1bdb3087981471d7d");
    const environment = {
      PI67_KNOWN_PACKAGE_BASELINES: JSON.stringify([{
        source: fixture.source,
        packageName: "@example/pi-package",
        packageVersion: "1.0.0",
        baselineContentSha256: observed.baselineContentSha256
      }])
    };
    const baselineRegistry = new PackageTrustRegistry({
      packageManager: fixture.packageManager,
      settingsManager: fixture.settingsManager,
      receipts: fixture.receipts,
      environment,
      now: () => 1_786_000_000_000
    });
    await baselineRegistry.refresh();
    expect(baselineRegistry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "known-baseline-observed"
    });
    expect(baselineRegistry.runtimePackageAllowed(fixture.source, "global")).toBe(true);

    environment.PI67_KNOWN_PACKAGE_BASELINES = "[]";
    await fixture.receipts.reserve({
      source: fixture.source,
      scope: "global",
      sourceKind: "npm",
      operation: "admit",
      idempotencyKey: "approve-1",
      fingerprint: "approve-1"
    });
    await fixture.receipts.markMutating(fixture.source, "global", "approve-1");
    await fixture.receipts.commitActive(
      fixture.source,
      "global",
      "approve-1",
      observed.observation,
      true
    );
    await baselineRegistry.refresh();
    expect(baselineRegistry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "user-approved-observed"
    });

    await writeFile(join(fixture.packageRoot, "index.js"), "export default 'changed';\n");
    await baselineRegistry.refresh();
    expect(baselineRegistry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "drifted",
      trustReason: "content-hash-changed"
    });
  });

  it("invalidates a known baseline when executable Python bytecode is added", async () => {
    const fixture = await trustFixture();
    await fixture.registry.refresh();
    const observed = fixture.registry.observationFor(fixture.source, "global");
    if (observed?.status !== "observed") throw new Error("expected observation");
    const baselineRegistry = new PackageTrustRegistry({
      packageManager: fixture.packageManager,
      settingsManager: fixture.settingsManager,
      receipts: fixture.receipts,
      environment: {
        PI67_KNOWN_PACKAGE_BASELINES: JSON.stringify([{
          source: fixture.source,
          packageName: "@example/pi-package",
          packageVersion: "1.0.0",
          baselineContentSha256: observed.baselineContentSha256
        }])
      }
    });
    await baselineRegistry.refresh();
    expect(baselineRegistry.runtimePackageAllowed(fixture.source, "global")).toBe(true);

    const bytecodeDirectory = join(fixture.packageRoot, "__pycache__");
    await mkdir(bytecodeDirectory);
    await writeFile(join(bytecodeDirectory, "payload.cpython-313.pyc"), "executable-bytecode");
    await baselineRegistry.refresh();

    expect(baselineRegistry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "unverified",
      trustReason: "receipt-missing"
    });
    expect(baselineRegistry.runtimePackageAllowed(fixture.source, "global")).toBe(false);
  });

  it("distinguishes manifest, directory identity, missing content, and unsafe manifests", async () => {
    const fixture = await trustedFixture();

    await writeFile(join(fixture.packageRoot, "package.json"), JSON.stringify({
      name: "@example/pi-package",
      version: "2.0.0"
    }));
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "drifted",
      trustReason: "manifest-changed"
    });

    const oldRoot = `${fixture.packageRoot}-old`;
    await rename(fixture.packageRoot, oldRoot);
    await mkdir(fixture.packageRoot);
    await writePackage(fixture.packageRoot);
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "drifted",
      trustReason: "directory-identity-changed"
    });

    await rm(fixture.packageRoot, { recursive: true, force: true });
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toEqual({
      trustState: "unavailable",
      trustReason: "install-content-missing"
    });

    await mkdir(fixture.packageRoot);
    const outsideManifest = join(fixture.root, "outside-package.json");
    await writeFile(outsideManifest, JSON.stringify({ name: "unsafe", version: "1.0.0" }));
    await symlink(outsideManifest, join(fixture.packageRoot, "package.json"));
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toEqual({
      trustState: "unavailable",
      trustReason: "receipt-invalid"
    });
    expect(await readFile(outsideManifest, "utf8")).toContain("unsafe");
  });

  it("uses a verified Desktop capability manifest and global receipts for project inheritance", async () => {
    const fixture = await trustFixture({ projectInheritance: true });
    const environment = {
      PI67_MANAGED_CAPABILITIES_ROOT: fixture.root,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([fixture.packageRoot])
    };
    const builtinRegistry = new PackageTrustRegistry({
      packageManager: {
        listConfiguredPackages: () => [{
          source: fixture.packageRoot,
          scope: "user" as const,
          filtered: false,
          installedPath: fixture.packageRoot
        }]
      },
      settingsManager: {
        getGlobalSettings: () => ({ packages: [fixture.packageRoot] }),
        getProjectSettings: () => ({ packages: [] })
      },
      receipts: fixture.receipts,
      environment,
      now: () => 1_786_000_000_000
    });
    await builtinRegistry.refresh();
    expect(builtinRegistry.projectionFor(fixture.packageRoot, "global")).toEqual({
      trustState: "builtin-verified",
      trustObservedAt: 1_786_000_000_000
    });
    environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([]);
    expect(builtinRegistry.runtimePackageAllowed(fixture.packageRoot, "global")).toBe(false);
    await builtinRegistry.refresh();
    expect(builtinRegistry.projectionFor(fixture.packageRoot, "global")).toMatchObject({
      trustState: "unverified",
      trustReason: "receipt-missing"
    });
    environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([fixture.packageRoot]);
    expect(builtinRegistry.runtimePackageAllowed(fixture.packageRoot, "global")).toBe(true);
    await builtinRegistry.refresh();
    expect(builtinRegistry.projectionFor(fixture.packageRoot, "global")).toEqual({
      trustState: "builtin-verified",
      trustObservedAt: 1_786_000_000_000
    });

    await fixture.registry.refresh();
    const observed = fixture.registry.observationFor(fixture.source, "global");
    if (observed?.status !== "observed") throw new Error("expected global observation");
    await fixture.receipts.reserve({
      source: fixture.source,
      scope: "global",
      sourceKind: "npm",
      operation: "install",
      idempotencyKey: "global-install",
      fingerprint: "global-install"
    });
    await fixture.receipts.markMutating(fixture.source, "global", "global-install");
    await fixture.receipts.commitActive(
      fixture.source,
      "global",
      "global-install",
      observed.observation,
      true
    );
    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "project")).toMatchObject({
      trustState: "user-installed-observed"
    });
  });

  it("demotes a durable receipt when its recorded source kind no longer matches", async () => {
    const fixture = await trustFixture();
    await fixture.registry.refresh();
    const observed = fixture.registry.observationFor(fixture.source, "global");
    if (observed?.status !== "observed") throw new Error("expected observation");
    await fixture.receipts.reserve({
      source: fixture.source,
      scope: "global",
      sourceKind: "git",
      operation: "install",
      idempotencyKey: "wrong-source-kind",
      fingerprint: "wrong-source-kind"
    });
    await fixture.receipts.markMutating(fixture.source, "global", "wrong-source-kind");
    await fixture.receipts.commitActive(
      fixture.source,
      "global",
      "wrong-source-kind",
      observed.observation,
      true
    );

    await fixture.registry.refresh();
    expect(fixture.registry.projectionFor(fixture.source, "global")).toMatchObject({
      trustState: "drifted",
      trustReason: "package-identity-changed"
    });
  });
});

async function trustedFixture() {
  const fixture = await trustFixture();
  await fixture.registry.refresh();
  const observed = fixture.registry.observationFor(fixture.source, "global");
  if (observed?.status !== "observed") throw new Error("expected observation");
  await fixture.receipts.reserve({
    source: fixture.source,
    scope: "global",
    sourceKind: "npm",
    operation: "install",
    idempotencyKey: "install-1",
    fingerprint: "install-1"
  });
  await fixture.receipts.markMutating(fixture.source, "global", "install-1");
  await fixture.receipts.commitActive(
    fixture.source,
    "global",
    "install-1",
    observed.observation,
    true
  );
  await fixture.registry.refresh();
  return fixture;
}

async function trustFixture(options: { projectInheritance?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi67-package-trust-"));
  roots.push(root);
  const packageRoot = join(root, "installed", "pi-package");
  await mkdir(packageRoot, { recursive: true });
  await writePackage(packageRoot);
  const source = "npm:@example/pi-package";
  const global: PackageSource[] = [source];
  const project: PackageSource[] = options.projectInheritance
    ? [{ source, autoload: false, extensions: ["**/*"] }]
    : [];
  const packageManager = {
    listConfiguredPackages: () => [
      { source, scope: "user" as const, filtered: false, installedPath: packageRoot },
      ...(options.projectInheritance
        ? [{ source, scope: "project" as const, filtered: true }]
        : [])
    ]
  };
  const settingsManager = {
    getGlobalSettings: () => ({ packages: global }),
    getProjectSettings: () => ({ packages: project })
  };
  const receipts = new PackageMutationReceiptStore({
    cwd: join(root, "workspace"),
    agentDir: join(root, "agent"),
    storageRoot: join(root, "storage"),
    now: () => 1_786_000_000_000
  });
  const registry = new PackageTrustRegistry({
    packageManager,
    settingsManager,
    receipts,
    now: () => 1_786_000_000_000
  });
  return { root, packageRoot, source, packageManager, settingsManager, receipts, registry };
}

async function writePackage(path: string): Promise<void> {
  await writeFile(join(path, "package.json"), JSON.stringify({
    name: "@example/pi-package",
    version: "1.0.0"
  }));
  await writeFile(join(path, "index.js"), "export default 'stable';\n");
}
