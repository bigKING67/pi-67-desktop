import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const versionSourcePath = "eng/version.json";

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[a-z-][0-9a-z-]*)(?:\.(?:0|[1-9]\d*|[a-z-][0-9a-z-]*))*))?$/iu;
const msiVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const jsonProjectionRules = [
  { path: "package.json", pointer: ["version"], value: ({ semver }) => semver },
  { path: "package-lock.json", pointer: ["version"], value: ({ semver }) => semver },
  { path: "package-lock.json", pointer: ["packages", "", "version"], value: ({ semver }) => semver },
  { path: "package-lock.json", pointer: ["packages", "extensions/pi67-desktop-safety", "version"], value: ({ semver }) => semver },
  { path: "package-lock.json", pointer: ["packages", "src/Pi67.Desktop.PiBridge", "version"], value: ({ semver }) => semver },
  { path: "src/Pi67.Desktop.PiBridge/package.json", pointer: ["version"], value: ({ semver }) => semver },
  { path: "extensions/pi67-desktop-safety/package.json", pointer: ["version"], value: ({ semver }) => semver },
  { path: "eng/compatibility/compatibility.json", pointer: ["desktopVersion"], value: ({ semver }) => semver },
  { path: "eng/packaging/bootstrap-inventory.json", pointer: ["desktopVersion"], value: ({ semver }) => semver },
];

const textProjectionRules = [
  {
    path: "Directory.Build.props",
    label: "Version",
    pattern: /(<Version>)([^<]+)(<\/Version>)/gu,
    value: ({ semver }) => semver,
  },
  {
    path: "Directory.Build.props",
    label: "AssemblyVersion",
    pattern: /(<AssemblyVersion>)([^<]+)(<\/AssemblyVersion>)/gu,
    value: ({ msiVersion }) => msiVersion,
  },
  {
    path: "Directory.Build.props",
    label: "FileVersion",
    pattern: /(<FileVersion>)([^<]+)(<\/FileVersion>)/gu,
    value: ({ msiVersion }) => msiVersion,
  },
  {
    path: "src/Pi67.Desktop.PiBridge/src/index.mjs",
    label: "bridgeVersion",
    pattern: /(bridgeVersion:\s*")([^"]+)(")/gu,
    value: ({ semver }) => semver,
  },
  {
    path: "installer/Pi67.Desktop.Msi/Package.wxs",
    label: "MSI package version",
    pattern: /(<Package[\s\S]*?\bVersion=")([^"]+)(")/gu,
    value: ({ msiVersion }) => msiVersion,
  },
  {
    path: "installer/Pi67.Desktop.Bundle/Bundle.wxs",
    label: "Burn bundle version",
    pattern: /(<Bundle[\s\S]*?\bVersion=")([^"]+)(")/gu,
    value: ({ msiVersion }) => msiVersion,
  },
  {
    path: "installer/Pi67.Desktop.Msi/Pi67.Desktop.Msi.wixproj",
    label: "MSI output name",
    pattern: /(<OutputName>Pi67-Desktop-)([^<]+)(-win-x64<\/OutputName>)/gu,
    value: ({ semver }) => semver,
  },
  {
    path: "installer/Pi67.Desktop.Bundle/Pi67.Desktop.Bundle.wixproj",
    label: "Burn MSI input name",
    pattern: /(Pi67-Desktop-)([^<\\]+)(-win-x64\.msi<\/MsiPath>)/gu,
    value: ({ semver }) => semver,
  },
  {
    path: "installer/Pi67.Desktop.Bundle/Pi67.Desktop.Bundle.wixproj",
    label: "Burn output name",
    pattern: /(<OutputName>Pi67-Desktop-Setup-)([^<]+)(-win-x64<\/OutputName>)/gu,
    value: ({ semver }) => semver,
  },
  {
    path: ".github/workflows/ci.yml",
    label: "CI artifact name",
    pattern: /(name:\s*pi67-desktop-)([^\s]+)(-win-x64-unsigned)/gu,
    value: ({ semver }) => semver,
  },
  {
    path: ".github/workflows/release-alpha.yml",
    label: "release tag",
    pattern: /(tag_name:\s*)([^\s]+)(\r?$)/gmu,
    value: ({ releaseTag }) => releaseTag,
  },
  {
    path: ".github/workflows/release-alpha.yml",
    label: "release display version",
    pattern: /(name:\s*Pi-67 Desktop )([^\s]+)( \(unsigned\))/gu,
    value: ({ semver }) => semver,
  },
];

function readPointer(document, pointer) {
  let value = document;
  for (const segment of pointer) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      return { found: false, value: undefined };
    }
    value = value[segment];
  }
  return { found: true, value };
}

function writePointer(document, pointer, value) {
  const target = pointer.slice(0, -1).reduce((current, segment) => current[segment], document);
  target[pointer.at(-1)] = value;
}

async function readRepositoryFiles(relativePaths, root) {
  const uniquePaths = [...new Set(relativePaths)];
  const entries = await Promise.all(uniquePaths.map(async relativePath => [
    relativePath,
    await readFile(path.join(root, relativePath), "utf8"),
  ]));
  return new Map(entries);
}

export function validateVersionContract(version) {
  const issues = [];
  if (version === null || typeof version !== "object" || Array.isArray(version)) {
    return ["eng/version.json must contain a JSON object"];
  }
  if (version.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  const semverMatch = typeof version.semver === "string" ? version.semver.match(semverPattern) : null;
  if (semverMatch === null) issues.push("semver must be a canonical SemVer value without build metadata");
  const msiMatch = typeof version.msiVersion === "string" ? version.msiVersion.match(msiVersionPattern) : null;
  if (msiMatch === null) issues.push("msiVersion must contain four numeric components");
  if (semverMatch !== null && msiMatch !== null) {
    const semverCore = semverMatch.slice(1, 4).join(".");
    const msiCore = msiMatch.slice(1, 4).join(".");
    if (semverCore !== msiCore) issues.push("msiVersion must share the SemVer major.minor.patch core");
  }
  if (typeof version.semver === "string" && version.releaseTag !== `desktop-v${version.semver}`) {
    issues.push("releaseTag must equal desktop-v{semver}");
  }
  const expectedKeys = ["msiVersion", "releaseTag", "schemaVersion", "semver"];
  const actualKeys = Object.keys(version).sort();
  if (actualKeys.join("\n") !== expectedKeys.join("\n")) {
    issues.push(`version source keys must be exactly: ${expectedKeys.join(", ")}`);
  }
  return issues;
}

export async function loadVersionContract(root = repositoryRoot) {
  const version = JSON.parse(await readFile(path.join(root, versionSourcePath), "utf8"));
  const issues = validateVersionContract(version);
  if (issues.length > 0) throw new Error(issues.join("\n"));
  return version;
}

export function releaseChannel(version) {
  const prerelease = version.semver.split("-", 2)[1];
  return prerelease?.split(".", 1)[0] ?? "stable";
}

export function releaseArtifactNames(version) {
  return {
    msi: `Pi67-Desktop-${version.semver}-win-x64.msi`,
    bundle: `Pi67-Desktop-Setup-${version.semver}-win-x64.exe`,
    ciArchive: `pi67-desktop-${version.semver}-win-x64-unsigned`,
  };
}

export async function inspectVersionProjections(version, root = repositoryRoot) {
  const files = await readRepositoryFiles([
    ...jsonProjectionRules.map(rule => rule.path),
    ...textProjectionRules.map(rule => rule.path),
  ], root);
  const jsonDocuments = new Map();
  const issues = [];

  for (const rule of jsonProjectionRules) {
    let document = jsonDocuments.get(rule.path);
    if (document === undefined) {
      document = JSON.parse(files.get(rule.path));
      jsonDocuments.set(rule.path, document);
    }
    const actual = readPointer(document, rule.pointer);
    const label = `${rule.path}#/${rule.pointer.join("/")}`;
    if (!actual.found) issues.push(`${label} is missing`);
    else if (actual.value !== rule.value(version)) {
      issues.push(`${label} is ${JSON.stringify(actual.value)}; expected ${JSON.stringify(rule.value(version))}`);
    }
  }

  for (const rule of textProjectionRules) {
    const matches = [...files.get(rule.path).matchAll(rule.pattern)];
    if (matches.length !== 1) {
      issues.push(`${rule.path} ${rule.label} matched ${matches.length} times; expected exactly once`);
    } else if (matches[0].length !== 4) {
      issues.push(`${rule.path} ${rule.label} must capture prefix, value, and suffix`);
    } else if (matches[0][2] !== rule.value(version)) {
      issues.push(`${rule.path} ${rule.label} is ${JSON.stringify(matches[0][2])}; expected ${JSON.stringify(rule.value(version))}`);
    }
  }
  return issues;
}

export async function syncVersionProjections(version, root = repositoryRoot) {
  const files = await readRepositoryFiles([
    ...jsonProjectionRules.map(rule => rule.path),
    ...textProjectionRules.map(rule => rule.path),
  ], root);
  const jsonDocuments = new Map();
  const structuralIssues = [];

  for (const rule of jsonProjectionRules) {
    let document = jsonDocuments.get(rule.path);
    if (document === undefined) {
      document = JSON.parse(files.get(rule.path));
      jsonDocuments.set(rule.path, document);
    }
    if (!readPointer(document, rule.pointer).found) {
      structuralIssues.push(`${rule.path}#/${rule.pointer.join("/")} is missing`);
    }
  }
  for (const rule of textProjectionRules) {
    const matches = [...files.get(rule.path).matchAll(rule.pattern)];
    if (matches.length !== 1) {
      structuralIssues.push(`${rule.path} ${rule.label} matched ${matches.length} times; expected exactly once`);
    } else if (matches[0].length !== 4) {
      structuralIssues.push(`${rule.path} ${rule.label} must capture prefix, value, and suffix`);
    }
  }
  if (structuralIssues.length > 0) throw new Error(structuralIssues.join("\n"));

  for (const rule of jsonProjectionRules) {
    writePointer(jsonDocuments.get(rule.path), rule.pointer, rule.value(version));
  }
  const updates = new Map([...jsonDocuments].map(([relativePath, document]) => [
    relativePath,
    `${JSON.stringify(document, null, 2)}\n`,
  ]));
  for (const relativePath of new Set(textProjectionRules.map(rule => rule.path))) {
    let contents = files.get(relativePath);
    for (const rule of textProjectionRules.filter(candidate => candidate.path === relativePath)) {
      const expected = rule.value(version);
      contents = contents.replace(rule.pattern, (_match, prefix, _current, suffix) => `${prefix}${expected}${suffix}`);
    }
    updates.set(relativePath, contents);
  }

  const changed = [...updates].filter(([relativePath, contents]) => files.get(relativePath) !== contents);
  await Promise.all(changed.map(([relativePath, contents]) => writeFile(path.join(root, relativePath), contents)));
  return changed.map(([relativePath]) => relativePath).sort();
}
