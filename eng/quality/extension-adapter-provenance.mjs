import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parseSync, visitorKeys } from "oxc-parser";
import { readNpmTarballFiles } from "./extension-adapter-provenance-tar.mjs";

export const EXTENSION_ADAPTER_PROVENANCE_LIMITS = Object.freeze({
  archiveBytes: 128 * 1024 * 1024,
  compressedBytes: 24 * 1024 * 1024,
  entries: 8_192,
  fileBytes: 32 * 1024 * 1024,
  metadataBytes: 1024 * 1024,
  sourceBytes: 4 * 1024 * 1024
});

export async function verifyExtensionAdapterPublishedArtifacts(record, artifacts) {
  const evidence = record?.evidence;
  if (!isPlainRecord(record) || !isPlainRecord(evidence)) {
    throw new Error("Extension Adapter provenance record must be conforming data");
  }
  if (!isPlainRecord(artifacts) || typeof artifacts.readRepositoryFile !== "function") {
    throw new Error("Extension Adapter provenance artifacts must provide bounded repository access");
  }
  verifyRegistryMetadata(evidence, artifacts.metadata);
  verifyPackageIntegrity(evidence.packageIntegrity, artifacts.tarballBytes);
  const tarballFiles = readNpmTarballFiles(
    artifacts.tarballBytes,
    EXTENSION_ADAPTER_PROVENANCE_LIMITS
  );
  const packageRoot = await resolveRepositoryPackageRoot(evidence, artifacts.readRepositoryFile);
  const repositoryPackageJson = await requiredRepositoryFile(
    artifacts.readRepositoryFile,
    repositoryPath(packageRoot, "package.json")
  );
  const npmPackageJson = requiredTarballFile(tarballFiles, "package/package.json");
  assertSameBytes("package.json", npmPackageJson, repositoryPackageJson);

  const verifiedSources = [];
  const sourceTexts = [];
  for (const sourcePath of evidence.sourcePaths) {
    if (!isPathInside(sourcePath, packageRoot)) {
      throw new Error(`source path ${sourcePath} is outside package root ${packageRoot}`);
    }
    const repositoryBytes = await requiredRepositoryFile(artifacts.readRepositoryFile, sourcePath);
    if (repositoryBytes.byteLength > EXTENSION_ADAPTER_PROVENANCE_LIMITS.sourceBytes) {
      throw new Error(`source path ${sourcePath} exceeds the provenance source limit`);
    }
    const packageRelativePath = packageRoot === "."
      ? sourcePath
      : posix.relative(packageRoot, sourcePath);
    const tarballPath = `package/${packageRelativePath}`;
    const npmBytes = requiredTarballFile(tarballFiles, tarballPath);
    assertSameBytes(sourcePath, npmBytes, repositoryBytes);
    sourceTexts.push(new TextDecoder("utf-8", { fatal: true }).decode(repositoryBytes));
    verifiedSources.push({
      repositoryPath: sourcePath,
      npmPath: tarballPath,
      sha256: sha256(repositoryBytes)
    });
  }

  const surfaces = extractStaticExtensionSurfaces(sourceTexts);
  assertSameSurfaceSet("commands", evidence.commands, surfaces.commands);
  assertSameSurfaceSet("tools", evidence.tools, surfaces.tools);

  return Object.freeze({
    adapterId: evidence.adapterId,
    package: evidence.package,
    installedVersion: evidence.installedVersion,
    license: evidence.license,
    packageIntegrity: evidence.packageIntegrity,
    packageRoot,
    sourceRepository: evidence.sourceRepository,
    sourceCommit: evidence.sourceCommit,
    verifiedSources: Object.freeze(verifiedSources.map((source) => Object.freeze(source))),
    commands: Object.freeze([...surfaces.commands]),
    tools: Object.freeze([...surfaces.tools])
  });
}

export function verifyRegistryMetadata(evidence, metadata) {
  if (!isPlainRecord(metadata)) throw new Error("npm registry metadata must be a plain object");
  if (metadata.name !== evidence.package || metadata.version !== evidence.installedVersion) {
    throw new Error(`npm identity mismatch for ${evidence.package}@${evidence.installedVersion}`);
  }
  if (metadata.license !== evidence.license) {
    throw new Error(`npm license mismatch for ${evidence.package}@${evidence.installedVersion}`);
  }
  if (metadata.gitHead !== evidence.sourceCommit) {
    throw new Error(`npm gitHead mismatch for ${evidence.package}@${evidence.installedVersion}`);
  }
  const repository = normalizeNpmRepository(metadata.repository);
  if (repository !== evidence.sourceRepository) {
    throw new Error(`npm repository mismatch for ${evidence.package}@${evidence.installedVersion}`);
  }
  if (!isPlainRecord(metadata.dist) || metadata.dist.integrity !== evidence.packageIntegrity) {
    throw new Error(`npm integrity metadata mismatch for ${evidence.package}@${evidence.installedVersion}`);
  }
  const tarball = readHttpsUrl(metadata.dist.tarball, "npm tarball");
  if (tarball.hostname !== "registry.npmjs.org") {
    throw new Error(`npm tarball host must be registry.npmjs.org, found ${tarball.hostname}`);
  }
  return tarball;
}

export function verifyPackageIntegrity(expectedIntegrity, bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("npm tarball must be bytes");
  if (bytes.byteLength === 0 || bytes.byteLength > EXTENSION_ADAPTER_PROVENANCE_LIMITS.compressedBytes) {
    throw new Error("npm tarball is empty or exceeds the provenance compressed limit");
  }
  const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (actual !== expectedIntegrity) throw new Error("npm tarball sha512 integrity mismatch");
  return actual;
}

export async function resolveRepositoryPackageRoot(evidence, readRepositoryFile) {
  const candidates = candidatePackageRoots(evidence.sourcePaths);
  for (const candidate of candidates) {
    const packageJsonBytes = await readRepositoryFile(repositoryPath(candidate, "package.json"));
    if (!packageJsonBytes) continue;
    const packageJson = parsePackageJson(packageJsonBytes, candidate);
    if (packageJson.name === evidence.package
      && packageJson.version === evidence.installedVersion
      && evidence.sourcePaths.every((sourcePath) => isPathInside(sourcePath, candidate))) {
      return candidate;
    }
  }
  throw new Error(
    `cannot locate ${evidence.package}@${evidence.installedVersion} package root at source commit`
  );
}

export function extractStaticExtensionSurfaces(sourceTexts) {
  const commands = new Set();
  const tools = new Set();
  for (const [index, sourceText] of sourceTexts.entries()) {
    const parsed = parseSync(`verified-source-${index}.ts`, sourceText, {
      lang: "ts",
      sourceType: "module"
    });
    if (parsed.errors.length > 0) {
      throw new Error(`verified source ${index + 1} contains TypeScript syntax errors`);
    }
    visit(parsed.program);
  }
  return Object.freeze({
    commands: Object.freeze([...commands].sort(compareOrdinal)),
    tools: Object.freeze([...tools].sort(compareOrdinal))
  });

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression") {
      const name = calledFunctionName(node.callee);
      if (name === "registerCommand") {
        const command = staticStringValue(node.arguments[0]);
        if (command) commands.add(command);
      } else if (name === "registerTool") {
        const tool = objectStringProperty(node.arguments[0], "name");
        if (tool) tools.add(tool);
      } else if (name === "defineTool" || name === "definePortableTool") {
        const tool = objectStringProperty(node.arguments[0], "name");
        if (tool) tools.add(tool);
      }
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) visit(item);
      } else {
        visit(child);
      }
    }
  }
}

function calledFunctionName(expression) {
  if (expression?.type === "Identifier") return expression.name;
  if (expression?.type !== "MemberExpression" || expression.computed) return undefined;
  return expression.property?.type === "Identifier" ? expression.property.name : undefined;
}

function staticStringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0]?.value?.cooked;
  }
  return undefined;
}

function objectStringProperty(node, name) {
  if (node?.type !== "ObjectExpression") return undefined;
  for (const property of node.properties) {
    if (property.type !== "Property" || property.computed || property.kind !== "init") continue;
    const propertyName = property.key.type === "Identifier"
      ? property.key.name
      : staticStringValue(property.key);
    if (propertyName === name) return staticStringValue(property.value);
  }
  return undefined;
}

function candidatePackageRoots(sourcePaths) {
  const candidates = new Set(["."]);
  for (const sourcePath of sourcePaths) {
    let current = posix.dirname(sourcePath);
    while (current !== ".") {
      candidates.add(current);
      current = posix.dirname(current);
    }
  }
  return [...candidates].sort((left, right) => pathDepth(right) - pathDepth(left));
}

function pathDepth(path) {
  return path === "." ? 0 : path.split("/").length;
}

function isPathInside(path, root) {
  if (root === ".") return !path.startsWith("../") && !posix.isAbsolute(path);
  const relative = posix.relative(root, path);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith("../")
    && !posix.isAbsolute(relative);
}

function repositoryPath(root, path) {
  return root === "." ? path : `${root}/${path}`;
}

function parsePackageJson(bytes, packageRoot) {
  if (!(bytes instanceof Uint8Array)
    || bytes.byteLength === 0
    || bytes.byteLength > EXTENSION_ADAPTER_PROVENANCE_LIMITS.metadataBytes) {
    throw new Error(`repository package.json is empty or oversized at ${packageRoot}`);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`repository package.json is invalid at ${packageRoot}`);
  }
}

function normalizeNpmRepository(repository) {
  const value = typeof repository === "string" ? repository : repository?.url;
  if (typeof value !== "string") throw new Error("npm repository metadata is missing");
  const normalized = value.replace(/^git\+/u, "").replace(/\.git\/?$/u, "").replace(/\/$/u, "");
  return readHttpsUrl(normalized, "npm repository").toString().replace(/\/$/u, "");
}

function readHttpsUrl(value, label) {
  if (typeof value !== "string") throw new Error(`${label} URL is missing`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error(`${label} must be a canonical HTTPS URL`);
  }
  return url;
}

async function requiredRepositoryFile(readRepositoryFile, path) {
  const bytes = await readRepositoryFile(path);
  if (!bytes) throw new Error(`source commit is missing ${path}`);
  return toBytes(bytes, `repository file ${path}`);
}

function requiredTarballFile(files, path) {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`npm tarball is missing ${path}`);
  return bytes;
}

function assertSameBytes(label, left, right) {
  const leftBytes = toBytes(left, label);
  const rightBytes = toBytes(right, label);
  if (leftBytes.byteLength !== rightBytes.byteLength || !leftBytes.equals(rightBytes)) {
    throw new Error(`npm and source commit bytes differ for ${label}`);
  }
}

function assertSameSurfaceSet(kind, expected, actual) {
  const left = [...expected].sort(compareOrdinal);
  const right = [...actual].sort(compareOrdinal);
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error(
      `static ${kind} mismatch: evidence=[${left.join(", ")}] source=[${right.join(", ")}]`
    );
  }
}

function toBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} must be bytes`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
