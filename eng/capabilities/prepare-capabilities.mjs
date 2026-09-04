import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileBundledSkillSuites, parseSkillMetadata, readPi67SkillPackMetadata } from "./bundled-skill-suites.mjs";
import {
  resolveBundledGitToolchain,
  resolveBundledNpmToolchain,
  resolveExactCapabilitySource
} from "./capability-source-resolver.mjs";
import {
  assertCapabilitiesMetadata,
  assertCapabilitySourceLock,
  treeSha256
} from "./prepared-capabilities-validation.mjs";
import { prepareManagedNpmBundles } from "./managed-npm-bundles.mjs";
import { preparePi67SkillPackOverlay } from "./pi67-skill-pack-overlay.mjs";
import {
  assertRelativePath,
  copyAllowedCapabilityEntries as copyAllowed,
  copyCapabilityEntry as copyEntry,
  writeCapabilityPackageManifest as writePackageManifest
} from "./prepared-capability-files.mjs";
import { assertPreparedLocalModuleClosure } from "./prepared-module-closure.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = resolve(repositoryRoot, "eng/capabilities/capability-sources.lock.json");
const skillSuitesPath = resolve(repositoryRoot, "eng/capabilities/bundled-skill-suites.json");
const outputRoot = resolve(repositoryRoot, "artifacts/capabilities/current");
const sourceCacheRoot = resolve(repositoryRoot, "artifacts/capabilities/sources");
const managedNpmCacheRoot = resolve(repositoryRoot, "artifacts/capabilities/npm-cache");
const managedNpmProjectRoot = resolve(repositoryRoot, "eng/capabilities/managed-npm");
const generatedSkillPackRoot = resolve(repositoryRoot, "artifacts/capabilities/generated/skill-packs");
const toolchainManifestPath = resolve(repositoryRoot, "artifacts/toolchain/current/manifest.json");
const execFileAsync = promisify(execFile);
const COMMERCE_SKILLS = new Set([
  "commerce-growth-os",
  "commerce-commercial-strategy",
  "commerce-operations",
  "commerce-analytics",
  "consumer-marketing-os",
  "brand-strategy-communications",
  "content-creative-social-marketing",
  "growth-performance-lifecycle-marketing"
]);

export async function prepareDesktopCapabilities() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const skillSuiteDefinition = JSON.parse(await readFile(skillSuitesPath, "utf8"));
  assertCapabilitySourceLock(lock);
  const [git, npmCommand] = await Promise.all([
    resolveBundledGitToolchain(toolchainManifestPath),
    resolveBundledNpmToolchain(toolchainManifestPath)
  ]);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputRoot, "packages"), { recursive: true });

  const sources = new Map();
  for (const source of lock.sources) {
    const sourceRoot = await resolveExactCapabilitySource({
      source,
      repositoryRoot,
      sourceCacheRoot,
      git
    });
    if (
      source.internalPath !== undefined
      && await treeSha256(sourceRoot, { includeNodeModules: false }) !== source.treeSha256
    ) {
      throw new Error(`Internal capability source failed integrity validation: ${source.id}`);
    }
    sources.set(source.id, sourceRoot);
  }
  const skillPackOverlays = [];
  for (const definition of lock.skillPacks) {
    const upstreamSourceRoot = await resolveExactCapabilitySource({
      source: {
        id: `skill-pack-${definition.name}`,
        repository: definition.repository,
        commit: definition.commit,
        localSibling: definition.localSibling
      },
      repositoryRoot,
      sourceCacheRoot,
      git
    });
    skillPackOverlays.push(await preparePi67SkillPackOverlay({
      definition,
      workspaceResourceRoot: sources.get(definition.adapterSourceId),
      upstreamSourceRoot,
      outputRoot: join(generatedSkillPackRoot, definition.name),
      adapterRoot: resolve(repositoryRoot, "eng/capabilities")
    }));
  }
  const entries = [];
  entries.push(await prepareWorkspaceResources(
    sources.get("pi-workspace-resources"),
    lock.sources.find((item) => item.id === "pi-workspace-resources"),
    skillPackOverlays
  ));
  entries.push(await prepareOpenVikingPiExtension(
    sources.get("openviking-pi-extension"),
    lock.sources.find((item) => item.id === "openviking-pi-extension")
  ));
  entries.push(await prepareBrowser67(
    sources.get("browser67"),
    lock.sources.find((item) => item.id === "browser67"),
    npmCommand
  ));
  entries.push(await prepareDesignCraft(sources.get("design-craft"), lock.sources.find((item) => item.id === "design-craft")));
  entries.push(await prepareCommerceGrowthOs(
    sources.get("commerce-growth-os"),
    lock.sources.find((item) => item.id === "commerce-growth-os")
  ));
  const overlayNames = new Set(skillPackOverlays.map((pack) => pack.name));
  const skillPacks = [
    ...(await readPi67SkillPackMetadata(sources.get("pi-workspace-resources")))
      .filter((pack) => !overlayNames.has(pack.name)),
    ...skillPackOverlays.map(({ sourceRoot: _sourceRoot, skills: _skills, ...pack }) => pack)
  ].sort((left, right) => left.name.localeCompare(right.name));
  const bundledSkillSuites = compileBundledSkillSuites(skillSuiteDefinition, entries, { skillPacks });
  const managedNpmBundle = await prepareManagedNpmBundles({
    lock,
    outputRoot,
    projectRoot: managedNpmProjectRoot,
    cacheRoot: managedNpmCacheRoot,
    npmCommand
  });

  const catalog = {
    schema: "pi67.capability-catalog.v1",
    catalogVersion: lock.catalogVersion,
    generatedFrom: entries.map(({ packagePath: _packagePath, resourceTypes: _resourceTypes, ...entry }) => entry),
    entries,
    bundledSkillSuites,
    managedNpmBundles: managedNpmBundle.packages,
    recommendedExternal: lock.recommendedExternal
  };
  const manifest = {
    schema: "pi67.desktop-capabilities.v1",
    catalogVersion: lock.catalogVersion,
    packages: await Promise.all(entries.map(async (entry) => ({
      id: entry.id,
      treeSha256: await treeSha256(join(outputRoot, entry.packagePath)),
      ...(entry.id === "browser67" ? { includeNodeModules: true } : {})
    }))),
    managedNpmBundle: {
      treeSha256: managedNpmBundle.treeSha256,
      platform: managedNpmBundle.platform,
      architecture: managedNpmBundle.architecture
    }
  };
  assertCapabilitiesMetadata(lock, catalog, manifest);
  await writeFile(join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Prepared ${entries.length} Pi-67 Desktop first-party capability packages (${lock.catalogVersion}).`);
  return { catalog, manifest };
}

async function prepareWorkspaceResources(sourceRoot, source, skillPackOverlays) {
  const destination = join(outputRoot, "packages", source.id);
  const sourceManifest = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
  const legacyRulesLoaderTreeSha256 = sourceManifest.desktopMigration?.legacyRulesLoaderTreeSha256;
  if (!/^[a-f0-9]{64}$/u.test(legacyRulesLoaderTreeSha256 ?? "")) {
    throw new Error("Pi workspace resources are missing the exact legacy Rules Loader migration identity.");
  }
  await mkdir(join(destination, "skills"), { recursive: true });
  await mkdir(join(destination, "extensions"), { recursive: true });
  await copyAllowed(sourceRoot, destination, ["prompts", "rules", "AGENTS.md", "README.md", "VERSION"]);
  for (const extension of source.includedExtensions) {
    await copyEntry(
      join(sourceRoot, "extensions", extension.id),
      join(destination, "extensions", extension.id),
      join(sourceRoot, "extensions")
    );
  }
  const overlaySkillRoots = new Map();
  for (const overlay of skillPackOverlays) {
    for (const skillName of overlay.skills) {
      if (COMMERCE_SKILLS.has(skillName) || overlaySkillRoots.has(skillName)) {
        throw new Error(`Bundled Skill Pack overlay is invalid: ${skillName}`);
      }
      overlaySkillRoots.set(skillName, overlay.sourceRoot);
    }
  }
  const sourceSkillNames = (await readdir(join(sourceRoot, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !COMMERCE_SKILLS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const skillNames = [...new Set([...sourceSkillNames, ...overlaySkillRoots.keys()])]
    .sort((left, right) => left.localeCompare(right));
  for (const skillName of skillNames) {
    const skillSourceRoot = overlaySkillRoots.get(skillName) ?? join(sourceRoot, "skills");
    await copyEntry(
      join(skillSourceRoot, skillName),
      join(destination, "skills", skillName),
      skillSourceRoot
    );
  }
  const extensions = (await readdir(join(destination, "extensions"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `extensions/${entry.name}`)
    .sort();
  const prompts = (await readdir(join(destination, "prompts"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `prompts/${entry.name}`)
    .sort();
  await writePackageManifest(destination, {
    name: "@pi67/bundled-workspace-resources",
    version: source.version,
    private: true,
    desktopMigration: { legacyRulesLoaderTreeSha256 },
    pi: {
      extensions,
      skills: skillNames.map((name) => `skills/${name}`),
      prompts
    }
  });
  return catalogEntry(
    source,
    "packages/pi-workspace-resources",
    ["extension", "skill", "prompt", "rule"],
    extensions.map((extensionPath) => {
      const id = basename(extensionPath);
      const metadata = source.includedExtensions.find((extension) => extension.id === id);
      if (!metadata) throw new Error(`Bundled Pi workspace Extension metadata is unavailable: ${id}`);
      return metadata;
    }),
    await bundledSkillEntries(destination, skillNames.map((name) => `skills/${name}`))
  );
}

async function prepareOpenVikingPiExtension(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  await copyAllowed(sourceRoot, destination, [
    "UPSTREAM.md",
    "archive-tool-support.ts",
    "client.ts",
    "client-contracts.ts",
    "config.json",
    "config.ts",
    "diagnostics.ts",
    "index.ts",
    "lib",
    "memory-owner-policy.ts",
    "package.json",
    "private-uri-policy.ts",
    "recall.ts",
    "recall-feedback.ts",
    "recall-tool-policy.ts",
    "recall-tool-support.ts",
    "runtime-privacy.ts",
    "shared",
    "sync.ts",
    "takeover.ts",
    "tool-result.ts",
    "tools.ts"
  ]);
  await assertPreparedLocalModuleClosure(destination, "index.ts");
  const packageManifest = JSON.parse(await readFile(join(destination, "package.json"), "utf8"));
  if (packageManifest.version !== source.version || packageManifest.pi?.extensions?.[0] !== "./index.ts") {
    throw new Error("Bundled OpenViking Pi Extension does not match its Desktop source lock.");
  }
  return catalogEntry(
    source,
    "packages/openviking-pi-extension",
    ["extension", "context", "memory", "experience"],
    source.includedExtensions
  );
}

async function prepareBrowser67(sourceRoot, source, npmCommand) {
  const destination = join(outputRoot, "packages", source.id);
  await copyAllowed(sourceRoot, destination, [
    "package.json",
    "package-lock.json",
    "LICENSE",
    "README.md",
    "bin",
    "src",
    "extension",
    "skills",
    "scripts/build-extension.mjs",
    "scripts/extension-install-doctor.mjs",
    "scripts/reload-extension-live.mjs",
    "scripts/setup-extension.mjs",
    "contracts/browser67-live-doctor.mjs",
    "contracts/browser67-live-doctor",
    "contracts/browser67-live-gate.mjs",
    "contracts/browser67-live-gate"
  ]);
  const packagePath = join(destination, "package.json");
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageManifest.version !== source.version) {
    throw new Error("Bundled browser67 version does not match the capability source lock");
  }
  await writeFile(packagePath, `${JSON.stringify({
    ...packageManifest,
    gitHead: source.commit
  }, null, 2)}\n`, "utf8");
  await execFileAsync(npmCommand.executable, [
    ...npmCommand.argumentsPrefix,
    "ci",
    "--omit=dev",
    "--omit=peer",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-bin-links"
  ], {
    cwd: destination,
    maxBuffer: 2_000_000,
    timeout: 5 * 60_000
  });
  await assertBrowser67PackageEntrypoints(destination);
  const skillPaths = (await readdir(join(destination, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `skills/${entry.name}`)
    .sort();
  return catalogEntry(
    source,
    "packages/browser67",
    ["skill", "integration"],
    [],
    await bundledSkillEntries(destination, skillPaths)
  );
}

async function assertBrowser67PackageEntrypoints(packageRoot) {
  const checks = [[
    join(packageRoot, "bin", "browser67.mjs"),
    "setup",
    "--help"
  ], [
    join(packageRoot, "scripts", "extension-install-doctor.mjs"),
    "--help"
  ]];
  for (const arguments_ of checks) {
    const { stdout } = await execFileAsync(process.execPath, arguments_, {
      cwd: packageRoot,
      env: {
        ...process.env,
        PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter)
      },
      maxBuffer: 1_000_000,
      timeout: 30_000
    });
    if (!String(stdout).includes("Usage:")) {
      throw new Error(`Bundled browser67 entrypoint did not report usage: ${relative(packageRoot, arguments_[0])}`);
    }
  }
}

async function prepareDesignCraft(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  await copyAllowed(sourceRoot, destination, [
    "skills/design-craft",
    "LICENSE",
    "LICENSES",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "VERSION",
    "package.json"
  ]);
  return catalogEntry(
    source,
    "packages/design-craft",
    ["skill"],
    [],
    await bundledSkillEntries(destination, ["skills/design-craft"])
  );
}

async function prepareCommerceGrowthOs(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  const pack = JSON.parse(await readFile(join(sourceRoot, "skill-pack.json"), "utf8"));
  if (!Array.isArray(pack.skills) || pack.pack_version !== source.version) {
    throw new Error("commerce-growth-os skill-pack.json does not match the locked package version.");
  }
  const skillPaths = [];
  for (const skill of pack.skills) {
    assertRelativePath(skill.source, "commerce skill source");
    const skillDestination = join(destination, "skills", skill.name);
    await copyEntry(join(sourceRoot, skill.source), skillDestination, sourceRoot);
    for (const resource of skill.resources ?? []) {
      assertRelativePath(resource.source, "commerce resource source");
      assertRelativePath(resource.target, "commerce resource target");
      await copyEntry(
        join(sourceRoot, resource.source),
        join(skillDestination, resource.target),
        sourceRoot
      );
    }
    skillPaths.push(`skills/${skill.name}`);
  }
  await copyAllowed(sourceRoot, destination, ["README.md", "skill-pack.json"]);
  await writePackageManifest(destination, {
    name: "@pi67/bundled-commerce-growth-os",
    version: source.version,
    private: true,
    pi: { skills: skillPaths }
  });
  return catalogEntry(
    source,
    "packages/commerce-growth-os",
    ["skill"],
    [],
    await bundledSkillEntries(destination, skillPaths)
  );
}

async function bundledSkillEntries(destination, skillPaths) {
  return Promise.all(skillPaths.map(async (skillPath) => {
    const id = basename(skillPath);
    const metadata = parseSkillMetadata(await readFile(join(destination, skillPath, "SKILL.md"), "utf8"));
    if (metadata.name !== id) {
      throw new Error(`Bundled Skill identity does not match its directory: ${skillPath}`);
    }
    return { id, displayName: metadata.name, description: metadata.description };
  }));
}

function catalogEntry(source, packagePath, resourceTypes, bundledExtensions = [], bundledSkills = []) {
  return {
    id: source.id,
    displayName: source.displayName,
    origin: source.origin,
    bundled: true,
    defaultEnabled: true,
    version: source.version,
    ...(source.internalPath === undefined
      ? { repository: source.repository, commit: source.commit }
      : { internalPath: source.internalPath, sourceTreeSha256: source.treeSha256 }),
    packagePath,
    resourceTypes,
    bundledExtensions,
    bundledSkills
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDesktopCapabilities();
}
