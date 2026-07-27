import { intersects, satisfies, valid } from "semver";

import {
  EXTENSION_ADAPTER_LIMITS,
  type ExtensionAdapterCommandManifest,
  type ExtensionAdapterManifest,
  type ExtensionAdapterToolManifest,
  type ExtensionAdapterToolPresentation
} from "./manifest.js";
import {
  isValidExtensionPackageName,
  isValidExtensionSurfaceName,
  parseExtensionAdapterManifest
} from "./manifest-validator.js";

export interface LoadedExtensionSurface {
  readonly package: string;
  readonly version: string;
  readonly commands?: readonly string[];
  readonly tools?: readonly string[];
}

export interface ExtensionAdapterCommandMatch extends ExtensionAdapterCommandManifest {
  readonly name: string;
}

export interface ExtensionAdapterToolMatch extends ExtensionAdapterToolManifest {
  readonly name: string;
  readonly presentation: ExtensionAdapterToolPresentation;
}

export interface ExtensionAdapterMatch {
  readonly adapterId: string;
  readonly schemaVersion: 1;
  readonly package: string;
  readonly installedVersion: string;
  readonly versionRange: string;
  readonly surfaces: readonly ("commands" | "tools")[];
  readonly commands: readonly ExtensionAdapterCommandMatch[];
  readonly tools: readonly ExtensionAdapterToolMatch[];
}

export interface ExtensionAdapterRegistry {
  readonly manifests: readonly ExtensionAdapterManifest[];
  readonly match: (surface: LoadedExtensionSurface) => ExtensionAdapterMatch | undefined;
}

export class ExtensionAdapterRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionAdapterRegistryError";
  }
}

export function createExtensionAdapterRegistry(inputs: readonly unknown[]): ExtensionAdapterRegistry {
  if (inputs.length > EXTENSION_ADAPTER_LIMITS.manifests) {
    throw new ExtensionAdapterRegistryError(`adapter registry cannot exceed ${EXTENSION_ADAPTER_LIMITS.manifests} manifests`);
  }
  const manifests = Object.freeze(inputs.map((input) => parseExtensionAdapterManifest(input)));
  assertUnambiguousManifests(manifests);

  return Object.freeze({
    manifests,
    match(surface: LoadedExtensionSurface): ExtensionAdapterMatch | undefined {
      const normalized = normalizeLoadedSurface(surface);
      if (!normalized) return undefined;
      const manifest = manifests.find((candidate) => (
        candidate.package === normalized.package && satisfies(normalized.version, candidate.versionRange)
      ));
      if (!manifest) return undefined;

      const commandNames = new Set(normalized.commands);
      const toolNames = new Set(normalized.tools);
      const commands = Object.freeze(Object.entries(manifest.commands)
        .filter(([name]) => commandNames.has(name))
        .map(([name, definition]) => Object.freeze(definition.description === undefined
          ? { name, label: definition.label }
          : { name, label: definition.label, description: definition.description })));
      const tools = Object.freeze(Object.entries(manifest.tools)
        .filter(([name]) => toolNames.has(name))
        .map(([name, definition]) => Object.freeze(definition.label === undefined
          ? { name, presentation: definition.presentation }
          : { name, presentation: definition.presentation, label: definition.label })));

      if (commands.length === 0 && tools.length === 0) return undefined;
      const surfaces = Object.freeze([
        ...(commands.length > 0 ? ["commands" as const] : []),
        ...(tools.length > 0 ? ["tools" as const] : [])
      ]);
      return Object.freeze({
        adapterId: manifest.id,
        schemaVersion: manifest.schemaVersion,
        package: manifest.package,
        installedVersion: normalized.version,
        versionRange: manifest.versionRange,
        surfaces,
        commands,
        tools
      });
    }
  });
}

function assertUnambiguousManifests(manifests: readonly ExtensionAdapterManifest[]): void {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) throw new ExtensionAdapterRegistryError(`duplicate adapter id: ${manifest.id}`);
    ids.add(manifest.id);
  }

  for (let leftIndex = 0; leftIndex < manifests.length; leftIndex += 1) {
    const left = manifests[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < manifests.length; rightIndex += 1) {
      const right = manifests[rightIndex];
      if (!right || left.package !== right.package) continue;
      if (intersects(left.versionRange, right.versionRange)) {
        throw new ExtensionAdapterRegistryError(
          `adapter ranges overlap for ${left.package}: ${left.id} and ${right.id}`
        );
      }
    }
  }
}

function normalizeLoadedSurface(surface: LoadedExtensionSurface): Required<LoadedExtensionSurface> | undefined {
  if (!isValidExtensionPackageName(surface.package)) return undefined;
  const normalizedVersion = valid(surface.version);
  if (normalizedVersion === null || normalizedVersion !== surface.version) return undefined;
  const commands = normalizeSurfaceNames(surface.commands, EXTENSION_ADAPTER_LIMITS.commands);
  const tools = normalizeSurfaceNames(surface.tools, EXTENSION_ADAPTER_LIMITS.tools);
  if (!commands || !tools) return undefined;
  return Object.freeze({ package: surface.package, version: normalizedVersion, commands, tools });
}

function normalizeSurfaceNames(values: readonly string[] | undefined, limit: number): readonly string[] | undefined {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values) || values.length > limit) return undefined;
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !isValidExtensionSurfaceName(value)) return undefined;
    unique.add(value);
  }
  return Object.freeze([...unique]);
}
