import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { releaseArtifactNames, releaseChannel } from "../version/version-contract.mjs";

export const releaseManifestName = "release-manifest.json";
export const provenanceName = "provenance.intoto.json";
export const checksumsName = "SHA256SUMS";

export function releasePayloadDescriptors(version) {
  const names = releaseArtifactNames(version);
  return [
    {
      path: names.msi,
      type: "windows-msi",
      mediaType: "application/x-msi",
      signatureStatus: "unsigned",
    },
    {
      path: names.bundle,
      type: "windows-burn-bundle",
      mediaType: "application/vnd.microsoft.portable-executable",
      signatureStatus: "unsigned",
    },
    {
      path: "compatibility.json",
      type: "compatibility-manifest",
      mediaType: "application/json",
      signatureStatus: "not-applicable",
    },
    {
      path: "bootstrap-inventory.json",
      type: "bootstrap-inventory",
      mediaType: "application/json",
      signatureStatus: "not-applicable",
    },
    {
      path: "pi67-desktop.cdx.json",
      type: "cyclonedx-sbom",
      mediaType: "application/vnd.cyclonedx+json",
      signatureStatus: "not-applicable",
    },
  ];
}

export function expectedReleaseFileNames(version) {
  return [
    ...releasePayloadDescriptors(version).map(descriptor => descriptor.path),
    releaseManifestName,
    provenanceName,
    checksumsName,
  ].sort();
}

export async function digestFile(file) {
  const [contents, metadata] = await Promise.all([readFile(file), stat(file)]);
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    size: metadata.size,
  };
}

export async function createReleaseManifestDocument(artifactRoot, version, sourceState, generatedAt = new Date()) {
  const descriptors = releasePayloadDescriptors(version);
  const artifacts = await Promise.all(descriptors.map(async descriptor => ({
    ...descriptor,
    ...await digestFile(path.join(artifactRoot, descriptor.path)),
  })));
  artifacts.sort((left, right) => left.path.localeCompare(right.path));

  return {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version: version.semver,
    msiVersion: version.msiVersion,
    releaseTag: version.releaseTag,
    channel: releaseChannel(version),
    platform: "win-x64",
    releaseStatus: "unsigned-controlled-test",
    signed: false,
    generatedAt: generatedAt.toISOString(),
    source: {
      repository: "https://github.com/bigKING67/pi-67-desktop",
      revision: sourceState.revision,
      dirty: sourceState.dirty,
    },
    artifacts,
    integrityChain: [releaseManifestName, provenanceName, checksumsName],
  };
}

export function parseChecksumText(contents) {
  const records = new Map();
  const lines = contents.endsWith("\n") ? contents.slice(0, -1).split("\n") : contents.split("\n");
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([0-9a-f]{64})  ([^\\/]+)$/u);
    if (match === null || match[2] === "." || match[2] === "..") {
      throw new Error(`Invalid SHA256SUMS line ${index + 1}`);
    }
    if (records.has(match[2])) throw new Error(`Duplicate SHA256SUMS entry: ${match[2]}`);
    records.set(match[2], match[1]);
  }
  return records;
}

function compareExactNames(actual, expected, label, issues) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const name of expectedSet) {
    if (!actualSet.has(name)) issues.push(`${label} is missing ${name}`);
  }
  for (const name of actualSet) {
    if (!expectedSet.has(name)) issues.push(`${label} contains unexpected ${name}`);
  }
}

function readJson(contents, name, issues) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    issues.push(`${name} is not valid JSON: ${error.message}`);
    return null;
  }
}

export async function verifyReleaseArtifactSet(artifactRoot, version) {
  const issues = [];
  const entries = await readdir(artifactRoot, { withFileTypes: true });
  const rootFiles = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  const nonFiles = entries.filter(entry => !entry.isFile()).map(entry => entry.name).sort();
  const expectedFiles = expectedReleaseFileNames(version);
  compareExactNames(rootFiles, expectedFiles, "release root", issues);
  if (nonFiles.length > 0) issues.push(`release root must be flat; found: ${nonFiles.join(", ")}`);
  if (issues.length > 0) return issues;

  const textFileNames = [
    releaseManifestName,
    provenanceName,
    checksumsName,
    "compatibility.json",
    "bootstrap-inventory.json",
    "pi67-desktop.cdx.json",
  ];
  const contents = new Map(await Promise.all(textFileNames.map(async name => [
    name,
    await readFile(path.join(artifactRoot, name), "utf8"),
  ])));
  const hashedNames = expectedFiles.filter(name => name !== checksumsName);
  const digests = new Map(await Promise.all(hashedNames.map(async name => [
    name,
    await digestFile(path.join(artifactRoot, name)),
  ])));

  const manifest = readJson(contents.get(releaseManifestName), releaseManifestName, issues);
  const provenance = readJson(contents.get(provenanceName), provenanceName, issues);
  const compatibility = readJson(contents.get("compatibility.json"), "compatibility.json", issues);
  const bootstrapInventory = readJson(contents.get("bootstrap-inventory.json"), "bootstrap-inventory.json", issues);
  const sbom = readJson(contents.get("pi67-desktop.cdx.json"), "pi67-desktop.cdx.json", issues);

  if (manifest !== null) {
    const expectedIdentity = {
      version: version.semver,
      msiVersion: version.msiVersion,
      releaseTag: version.releaseTag,
      channel: releaseChannel(version),
      platform: "win-x64",
      releaseStatus: "unsigned-controlled-test",
      signed: false,
    };
    for (const [key, expected] of Object.entries(expectedIdentity)) {
      if (manifest[key] !== expected) issues.push(`${releaseManifestName} ${key} does not match the release contract`);
    }
    if (manifest.product !== "Pi-67 Desktop" || manifest.schemaVersion !== 1) {
      issues.push(`${releaseManifestName} product identity is invalid`);
    }
    if (manifest.source?.repository !== "https://github.com/bigKING67/pi-67-desktop"
      || (manifest.source?.revision !== "uncommitted-source" && !/^[0-9a-f]{40}$/u.test(manifest.source?.revision ?? ""))
      || (manifest.source?.dirty !== null && typeof manifest.source?.dirty !== "boolean")) {
      issues.push(`${releaseManifestName} source identity is invalid`);
    }
    if (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt))) {
      issues.push(`${releaseManifestName} generatedAt is invalid`);
    }
    if (!Array.isArray(manifest.integrityChain)
      || manifest.integrityChain.join("\n") !== [releaseManifestName, provenanceName, checksumsName].join("\n")) {
      issues.push(`${releaseManifestName} integrityChain is invalid`);
    }

    const artifactValues = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    const actualArtifacts = artifactValues.filter(artifact => artifact !== null && typeof artifact === "object");
    const expectedDescriptors = releasePayloadDescriptors(version);
    if (actualArtifacts.length !== artifactValues.length) {
      issues.push(`${releaseManifestName} artifacts contains invalid entries`);
    }
    if (new Set(actualArtifacts.map(artifact => artifact.path)).size !== actualArtifacts.length) {
      issues.push(`${releaseManifestName} artifacts contains duplicate paths`);
    }
    compareExactNames(
      actualArtifacts.map(artifact => artifact.path),
      expectedDescriptors.map(descriptor => descriptor.path),
      `${releaseManifestName} artifacts`,
      issues,
    );
    for (const descriptor of expectedDescriptors) {
      const artifact = actualArtifacts.find(candidate => candidate.path === descriptor.path);
      if (artifact === undefined) continue;
      for (const key of ["type", "mediaType", "signatureStatus"]) {
        if (artifact[key] !== descriptor[key]) issues.push(`${releaseManifestName} ${descriptor.path} ${key} is invalid`);
      }
      const digest = digests.get(descriptor.path);
      if (artifact.sha256 !== digest.sha256 || artifact.size !== digest.size) {
        issues.push(`${releaseManifestName} ${descriptor.path} digest or size is stale`);
      }
    }
  }

  if (compatibility?.desktopVersion !== version.semver) issues.push("compatibility.json desktopVersion is stale");
  if (bootstrapInventory?.desktopVersion !== version.semver) issues.push("bootstrap-inventory.json desktopVersion is stale");
  if (sbom?.metadata?.component?.version !== version.semver) issues.push("CycloneDX application version is stale");

  let checksumRecords = null;
  try {
    checksumRecords = parseChecksumText(contents.get(checksumsName));
  } catch (error) {
    issues.push(error.message);
  }
  if (checksumRecords !== null) {
    compareExactNames([...checksumRecords.keys()], hashedNames, checksumsName, issues);
    for (const name of hashedNames) {
      if (checksumRecords.get(name) !== digests.get(name).sha256) issues.push(`${checksumsName} digest is stale for ${name}`);
    }
  }

  if (provenance !== null) {
    const provenanceSubjectNames = [
      ...releasePayloadDescriptors(version).map(descriptor => descriptor.path),
      releaseManifestName,
    ].sort();
    const subjectValues = Array.isArray(provenance.subject) ? provenance.subject : [];
    const subjects = subjectValues.filter(subject => subject !== null && typeof subject === "object");
    if (subjects.length !== subjectValues.length) {
      issues.push(`${provenanceName} subjects contains invalid entries`);
    }
    if (new Set(subjects.map(subject => subject.name)).size !== subjects.length) {
      issues.push(`${provenanceName} subjects contains duplicate paths`);
    }
    compareExactNames(subjects.map(subject => subject.name), provenanceSubjectNames, `${provenanceName} subjects`, issues);
    for (const name of provenanceSubjectNames) {
      const subject = subjects.find(candidate => candidate.name === name);
      if (subject?.digest?.sha256 !== digests.get(name).sha256) {
        issues.push(`${provenanceName} digest is stale for ${name}`);
      }
    }
    const revision = manifest?.source?.revision;
    if (typeof revision !== "string"
      || provenance.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.gitCommit !== revision
      || !provenance.predicate?.buildDefinition?.buildType?.endsWith(`@${revision}`)) {
      issues.push(`${provenanceName} source revision does not match ${releaseManifestName}`);
    }
    if (provenance.predicate?.runDetails?.metadata?.sourceDirty !== manifest?.source?.dirty) {
      issues.push(`${provenanceName} source dirty state does not match ${releaseManifestName}`);
    }
  }
  return issues;
}
