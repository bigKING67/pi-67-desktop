import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseCapabilityCatalog,
  parseCapabilityManifest
} from "./desktop-capability-catalog.js";
import {
  capabilityTreeSha256,
  containedCapabilityPath,
  isContainedPath,
  isNodeError,
  isRecord,
  readBoundedCapabilityJson,
  replaceCapabilityDirectoryIfChanged
} from "./desktop-capability-file-integrity.js";
import {
  projectCompatibilityExtension,
  projectSharedOpenVikingExtension,
  type DesktopCompatibilityProjection,
  type DesktopOpenVikingProjection
} from "./desktop-compatibility-extension.js";
import {
  activateSharedProfile,
  type DesktopSharedProfileProjection,
  type SharedProfilePackage
} from "./desktop-shared-profile.js";
import { managedSkillPackPackagePaths } from "./managed-skill-pack-state.js";

const STATE_SCHEMA = "pi67.desktop-capability-state.v1";
const MAX_METADATA_BYTES = 1_000_000;

export { capabilityTreeSha256 } from "./desktop-capability-file-integrity.js";

export interface DesktopCapabilityBootstrapOptions {
  capabilitiesRoot?: string;
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  profileOwnership?: "desktop" | "shared";
  createToken?: () => string;
}

export interface DesktopCapabilityBootstrapResult {
  enabled: boolean;
  catalogVersion?: string;
  managedRoot?: string;
  packagePaths: string[];
  rules: "installed" | "unavailable";
  agents: "installed" | "user-owned" | "unavailable";
  projectionMode?: "packaged-direct" | "legacy-copy" | "shared-profile";
  sharedProfile?: DesktopSharedProfileProjection;
  openVikingProjection?: DesktopOpenVikingProjection;
  rulesLoaderProjection?: DesktopCompatibilityProjection;
}

export async function bootstrapDesktopCapabilities(
  options: DesktopCapabilityBootstrapOptions
): Promise<DesktopCapabilityBootstrapResult> {
  const environment = options.environment ?? process.env;
  const configuredRoot = options.capabilitiesRoot ?? environment.PI67_CAPABILITIES_ROOT;
  if (environment.PI67_DESKTOP !== "1" || !configuredRoot) {
    return { enabled: false, packagePaths: [], rules: "unavailable", agents: "unavailable" };
  }
  const capabilitiesRoot = resolve(configuredRoot);
  const agentDir = resolve(options.agentDir);
  const managedRoot = join(agentDir, "desktop-capabilities");
  const createToken = options.createToken ?? randomUUID;
  const previousOpenVikingTreeSha256 = await readPreviousOpenVikingTreeSha256(managedRoot);
  const previousRulesLoaderTreeSha256 = await readPreviousRulesLoaderTreeSha256(managedRoot);
  let manifestValue: unknown;
  let catalogValue: unknown;
  try {
    [manifestValue, catalogValue] = await Promise.all([
      readBoundedCapabilityJson(join(capabilitiesRoot, "manifest.json")),
      readBoundedCapabilityJson(join(capabilitiesRoot, "catalog.json"))
    ]);
  } catch (error) {
    if (environment.PI67_PACKAGED !== "1" && isNodeError(error, "ENOENT")) {
      return { enabled: false, packagePaths: [], rules: "unavailable", agents: "unavailable" };
    }
    throw error;
  }
  const manifest = parseCapabilityManifest(manifestValue);
  const catalog = parseCapabilityCatalog(catalogValue);
  if (!manifest || !catalog || manifest.catalogVersion !== catalog.catalogVersion) {
    throw new Error("Desktop capability metadata is invalid or inconsistent.");
  }
  const manifestById = new Map(manifest.packages.map((entry) => [entry.id, entry]));
  if (
    manifestById.size !== catalog.entries.length
    || catalog.entries.some((entry) => !manifestById.has(entry.id))
  ) throw new Error("Desktop capability catalog does not match its integrity manifest.");

  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(managedRoot, { recursive: true, mode: 0o700 });
  const sharedPackages: SharedProfilePackage[] = [];
  for (const entry of catalog.entries) {
    const integrity = manifestById.get(entry.id)!;
    const source = containedCapabilityPath(capabilitiesRoot, entry.packagePath, "Capability package path");
    if (environment.PI67_PACKAGED === "1") {
      await validatePackagedCapabilityPackage(capabilitiesRoot, source, entry.id);
    }
    const sourceHash = await capabilityTreeSha256(source, integrity.includeNodeModules);
    if (sourceHash !== integrity.treeSha256) {
      throw new Error(`Desktop capability ${entry.id} failed bundled integrity verification.`);
    }
    sharedPackages.push({
      id: entry.id,
      displayName: entry.displayName,
      source,
      packagePath: `packages/${entry.id}`,
      treeSha256: integrity.treeSha256,
      includeNodeModules: integrity.includeNodeModules === true
    });
  }

  const sharedProfile = await activateSharedProfile({
    agentDir,
    managedRoot,
    catalogVersion: catalog.catalogVersion,
    packages: sharedPackages,
    createToken
  });
  const bundledPackagePaths = sharedPackages.map((entry) => (
    join(sharedProfile.root, entry.packagePath)
  ));

  const openVikingIndex = catalog.entries.findIndex((entry) => entry.id === "openviking-pi-extension");
  const openVikingProjection = openVikingIndex < 0
    ? { status: "unavailable" as const }
    : await projectSharedOpenVikingExtension({
        source: bundledPackagePaths[openVikingIndex]!,
        destination: join(agentDir, "extensions", "pi67-openviking"),
        expectedHash: manifestById.get("openviking-pi-extension")!.treeSha256,
        ...(previousOpenVikingTreeSha256 === undefined
          ? {}
          : { previousHash: previousOpenVikingTreeSha256 }),
        agentDir,
        createToken
      });
  if (openVikingProjection.status === "unavailable") {
    delete environment.PI67_OPENVIKING_SHARED_PROJECTION;
  } else {
    environment.PI67_OPENVIKING_SHARED_PROJECTION = openVikingProjection.status === "user-owned"
      ? "conflict"
      : "managed";
  }

  const workspaceResources = bundledPackagePaths[catalog.entries.findIndex((entry) => entry.id === "pi-workspace-resources")];
  const legacyRulesLoaderTreeSha256 = workspaceResources
    ? await readLegacyRulesLoaderTreeSha256(workspaceResources)
    : undefined;
  const rulesLoaderProjection = workspaceResources
    ? await projectCompatibilityExtension({
        source: join(workspaceResources, "extensions", "pi-rules-loader"),
        destination: join(agentDir, "extensions", "pi-rules-loader"),
        ...(previousRulesLoaderTreeSha256 === undefined
          ? {}
          : { previousHash: previousRulesLoaderTreeSha256 }),
        ...(legacyRulesLoaderTreeSha256 === undefined
          ? {}
          : { safePriorHashes: [legacyRulesLoaderTreeSha256] }),
        agentDir,
        createToken
      })
    : { status: "unavailable" as const };
  const rules = workspaceResources && existsSync(join(workspaceResources, "rules"))
    ? await materializeRules(join(workspaceResources, "rules"), join(agentDir, "rules", "pi67-desktop"), agentDir, createToken)
    : "unavailable";
  const agents = workspaceResources
    ? await materializeAgentsFile(join(workspaceResources, "AGENTS.md"), join(agentDir, "AGENTS.md"))
    : "unavailable";
  await writeState(managedRoot, {
    schema: STATE_SCHEMA,
    catalogVersion: catalog.catalogVersion,
    packages: catalog.entries.map((entry, index) => ({
      id: entry.id,
      displayName: entry.displayName,
      resourceTypes: entry.resourceTypes,
      treeSha256: manifestById.get(entry.id)!.treeSha256,
      installed: true,
      packageIndex: index
    })),
    rules,
    agents,
    sharedProfile,
    openVikingProjection,
    rulesLoaderProjection,
    profileOwnership: options.profileOwnership ?? "desktop",
    preparedAt: Date.now()
  }, createToken);
  if (process.platform !== "win32") await chmod(managedRoot, 0o700);

  const packagePaths = [
    ...await managedSkillPackPackagePaths(agentDir),
    ...bundledPackagePaths
  ];
  environment.PI67_BUNDLED_CAPABILITIES_ROOT = capabilitiesRoot;
  environment.PI67_MANAGED_CAPABILITIES_ROOT = managedRoot;
  environment.PI67_SHARED_PROFILE_ROOT = sharedProfile.root;
  environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify(packagePaths);
  environment.PI67_KNOWN_PACKAGE_BASELINES = JSON.stringify(
    catalog.recommendedExternal
      .filter((entry) => (
        entry.admissionPolicy === "known-baseline-or-user-approval"
        && entry.baselineContentSha256 !== undefined
        && entry.recommendedVersion !== undefined
      ))
      .map((entry) => ({
        source: entry.source,
        packageName: entry.source.slice("npm:".length),
        packageVersion: entry.recommendedVersion,
        baselineContentSha256: entry.baselineContentSha256
      }))
  );
  return {
    enabled: true,
    catalogVersion: catalog.catalogVersion,
    managedRoot,
    packagePaths,
    rules,
    agents,
    projectionMode: "shared-profile",
    sharedProfile,
    openVikingProjection,
    rulesLoaderProjection
  };
}

async function readPreviousOpenVikingTreeSha256(managedRoot: string): Promise<string | undefined> {
  try {
    const state = await readBoundedCapabilityJson(join(managedRoot, "state.json"));
    if (!isRecord(state) || !Array.isArray(state.packages)) return undefined;
    const entry = state.packages.find((candidate) => (
      isRecord(candidate) && candidate.id === "openviking-pi-extension"
    ));
    if (!isRecord(entry) || typeof entry.treeSha256 !== "string") return undefined;
    return /^[a-f0-9]{64}$/u.test(entry.treeSha256) ? entry.treeSha256 : undefined;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    return undefined;
  }
}

async function readPreviousRulesLoaderTreeSha256(managedRoot: string): Promise<string | undefined> {
  try {
    const state = await readBoundedCapabilityJson(join(managedRoot, "state.json"));
    if (!isRecord(state) || !isRecord(state.rulesLoaderProjection)) return undefined;
    const hash = state.rulesLoaderProjection.treeSha256;
    return typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash) ? hash : undefined;
  } catch {
    return undefined;
  }
}

async function readLegacyRulesLoaderTreeSha256(workspaceResources: string): Promise<string | undefined> {
  try {
    const manifest = await readBoundedCapabilityJson(join(workspaceResources, "package.json"));
    if (!isRecord(manifest) || !isRecord(manifest.desktopMigration)) return undefined;
    const hash = manifest.desktopMigration.legacyRulesLoaderTreeSha256;
    return typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash) ? hash : undefined;
  } catch {
    return undefined;
  }
}

async function validatePackagedCapabilityPackage(
  capabilitiesRoot: string,
  packageRoot: string,
  packageId: string
): Promise<void> {
  const [rootMetadata, packageMetadata, canonicalRoot, canonicalPackage] = await Promise.all([
    lstat(capabilitiesRoot),
    lstat(packageRoot),
    realpath(capabilitiesRoot),
    realpath(packageRoot)
  ]);
  if (
    rootMetadata.isSymbolicLink()
    || !rootMetadata.isDirectory()
    || packageMetadata.isSymbolicLink()
    || !packageMetadata.isDirectory()
    || !isContainedPath(canonicalPackage, canonicalRoot)
  ) throw new Error(`Desktop capability ${packageId} has an invalid packaged root.`);
  const manifestPath = join(packageRoot, "package.json");
  const manifestMetadata = await lstat(manifestPath);
  if (
    manifestMetadata.isSymbolicLink()
    || !manifestMetadata.isFile()
    || manifestMetadata.size > MAX_METADATA_BYTES
  ) throw new Error(`Desktop capability ${packageId} has invalid packaged metadata.`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isRecord(manifest) || typeof manifest.name !== "string" || manifest.name.length > 214) {
    throw new Error(`Desktop capability ${packageId} has invalid packaged metadata.`);
  }
}

async function materializeRules(
  source: string,
  destination: string,
  containmentRoot: string,
  createToken: () => string
): Promise<"installed"> {
  const expected = await capabilityTreeSha256(source);
  await replaceCapabilityDirectoryIfChanged({
    source,
    destination,
    expectedHash: expected,
    containmentRoot,
    createToken
  });
  return "installed";
}

async function materializeAgentsFile(
  source: string,
  destination: string
): Promise<"installed" | "user-owned" | "unavailable"> {
  try {
    const existing = await lstat(destination);
    if (existing.isSymbolicLink() || !existing.isFile()) return "user-owned";
    return "user-owned";
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  try {
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
      return "unavailable";
    }
    await writeFile(destination, await readFile(source), { flag: "wx", mode: 0o600 });
    return "installed";
  } catch (error) {
    if (isNodeError(error, "EEXIST")) return "user-owned";
    if (isNodeError(error, "ENOENT")) return "unavailable";
    throw error;
  }
}

async function writeState(root: string, value: unknown, createToken: () => string): Promise<void> {
  const path = join(root, "state.json");
  const temporary = join(root, `.state.${process.pid}.${createToken()}.tmp`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}
