import type { Extension, SourceInfo } from "@earendil-works/pi-coding-agent";
import {
  type ExtensionCommandAdapterView,
  type ExtensionToolAdapterView
} from "@pi67/domain";
import {
  EXTENSION_ADAPTER_LIMITS,
  type ExtensionAdapterMatch,
  type ExtensionAdapterRegistry,
  isValidExtensionSurfaceName
} from "@pi67/extension-compat";
import {
  resolveExtensionPackageIdentity,
  type ResolvedExtensionPackageIdentity
} from "./extension-package-identity.js";

const EXTENSION_ADAPTER_PROJECTION_LIMITS = Object.freeze({
  loadedExtensions: 128,
  runtimeCommands: 1_024,
  runtimeTools: 1_024,
  effectiveTools: 512,
  extensionIdCharacters: 2_048
});

type ProjectionExtension = Pick<Extension, "hidden" | "path" | "resolvedPath" | "sourceInfo">;

export interface ExtensionAdapterCommandSource {
  readonly name: string;
  readonly source: string;
  readonly sourceInfo: SourceInfo;
}

export interface ExtensionAdapterToolSource {
  readonly name: string;
  readonly sourceInfo: SourceInfo;
}

export interface ExtensionAdapterProjectionSource {
  readonly extensions: readonly ProjectionExtension[];
  readonly runtime: {
    readonly getCommands: () => readonly ExtensionAdapterCommandSource[];
  };
}

export interface ExtensionAdapterSessionSource {
  readonly getAllTools: () => readonly ExtensionAdapterToolSource[];
}

export type ToolAdapterView = Readonly<ExtensionToolAdapterView>;

export interface ExtensionAdapterProjection {
  readonly matchesByExtension: ReadonlyMap<string, ExtensionAdapterMatch>;
  readonly effectiveCommands: ReadonlyMap<string, Readonly<ExtensionCommandAdapterView>>;
  readonly effectiveTools: ReadonlyMap<string, ToolAdapterView>;
  readonly activeAdapterCount: number;
}

interface ExtensionCandidate {
  readonly extensionId: string;
  readonly sourceInfo: SourceInfo;
  readonly identity: ResolvedExtensionPackageIdentity;
  readonly commands: Set<string>;
  readonly tools: Set<string>;
}

export async function projectExtensionAdapterProjection(
  extensionsResult: ExtensionAdapterProjectionSource | undefined,
  session: ExtensionAdapterSessionSource | undefined,
  registry: ExtensionAdapterRegistry
): Promise<ExtensionAdapterProjection> {
  if (!extensionsResult || !session || registry.manifests.length === 0) return EMPTY_EXTENSION_ADAPTER_PROJECTION;

  const candidates = await resolveCandidates(extensionsResult.extensions);
  if (candidates.length === 0) return EMPTY_EXTENSION_ADAPTER_PROJECTION;

  projectResolvedCommands(candidates, extensionsResult.runtime.getCommands());
  projectEffectiveTools(candidates, session.getAllTools());

  const matchesByExtension = new Map<string, ExtensionAdapterMatch>();
  const effectiveCommands = new Map<string, Readonly<ExtensionCommandAdapterView>>();
  const effectiveTools = new Map<string, ToolAdapterView>();
  for (const candidate of candidates) {
    const match = registry.match({
      package: candidate.identity.name,
      version: candidate.identity.version,
      commands: [...candidate.commands],
      tools: [...candidate.tools]
    });
    if (!match) continue;
    matchesByExtension.set(candidate.extensionId, match);
    for (const command of match.commands) {
      if (effectiveCommands.has(command.name)) continue;
      effectiveCommands.set(command.name, freezeCommandAdapter(match, command));
    }
    for (const tool of match.tools) {
      if (effectiveTools.size >= EXTENSION_ADAPTER_PROJECTION_LIMITS.effectiveTools) break;
      if (effectiveTools.has(tool.name)) continue;
      effectiveTools.set(tool.name, freezeToolAdapter(match, tool));
    }
  }

  return Object.freeze({
    matchesByExtension: freezeMap(matchesByExtension),
    effectiveCommands: freezeMap(effectiveCommands),
    effectiveTools: freezeMap(effectiveTools),
    activeAdapterCount: matchesByExtension.size
  });
}

async function resolveCandidates(extensions: readonly ProjectionExtension[]): Promise<ExtensionCandidate[]> {
  const bounded = extensions
    .filter((extension) => !extension.hidden)
    .slice(0, EXTENSION_ADAPTER_PROJECTION_LIMITS.loadedExtensions);
  const resolved = await Promise.all(bounded.map(async (extension) => ({
    extension,
    extensionId: boundedExtensionId(extension),
    identity: await resolveExtensionPackageIdentity(extension)
  })));
  const idCounts = new Map<string, number>();
  for (const item of resolved) {
    if (item.extensionId) idCounts.set(item.extensionId, (idCounts.get(item.extensionId) ?? 0) + 1);
  }
  return resolved.flatMap(({ extension, extensionId, identity }) => {
    if (!extensionId || !identity || idCounts.get(extensionId) !== 1) return [];
    return [{
      extensionId,
      sourceInfo: extension.sourceInfo,
      identity,
      commands: new Set<string>(),
      tools: new Set<string>()
    }];
  });
}

function projectResolvedCommands(
  candidates: readonly ExtensionCandidate[],
  commands: readonly ExtensionAdapterCommandSource[]
): void {
  if (commands.length > EXTENSION_ADAPTER_PROJECTION_LIMITS.runtimeCommands) return;
  const nameCounts = countValidNames(commands.map((command) => command.name));
  for (const command of commands) {
    if (command.source !== "extension" || nameCounts.get(command.name) !== 1) continue;
    const owner = resolveOwner(candidates, command.sourceInfo);
    if (owner && owner.commands.size < EXTENSION_ADAPTER_LIMITS.commands) owner.commands.add(command.name);
  }
}

function projectEffectiveTools(
  candidates: readonly ExtensionCandidate[],
  tools: readonly ExtensionAdapterToolSource[]
): void {
  if (tools.length > EXTENSION_ADAPTER_PROJECTION_LIMITS.runtimeTools) return;
  const nameCounts = countValidNames(tools.map((tool) => tool.name));
  for (const tool of tools) {
    if (nameCounts.get(tool.name) !== 1) continue;
    const owner = resolveOwner(candidates, tool.sourceInfo);
    if (owner && owner.tools.size < EXTENSION_ADAPTER_LIMITS.tools) owner.tools.add(tool.name);
  }
}

function resolveOwner(
  candidates: readonly ExtensionCandidate[],
  sourceInfo: SourceInfo
): ExtensionCandidate | undefined {
  const exact = candidates.filter((candidate) => candidate.sourceInfo === sourceInfo);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const structural = candidates.filter((candidate) => sameSourceInfo(candidate.sourceInfo, sourceInfo));
  return structural.length === 1 ? structural[0] : undefined;
}

function sameSourceInfo(left: SourceInfo, right: SourceInfo): boolean {
  return left.path === right.path
    && left.source === right.source
    && left.scope === right.scope
    && left.origin === right.origin
    && left.baseDir === right.baseDir;
}

function countValidNames(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (!isValidExtensionSurfaceName(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function boundedExtensionId(extension: ProjectionExtension): string | undefined {
  const value = extension.resolvedPath || extension.path || extension.sourceInfo.path;
  if (!value || value.length > EXTENSION_ADAPTER_PROJECTION_LIMITS.extensionIdCharacters) return undefined;
  return value;
}

function freezeToolAdapter(
  match: ExtensionAdapterMatch,
  tool: ExtensionAdapterMatch["tools"][number]
): ToolAdapterView {
  return Object.freeze({
    adapterId: match.adapterId,
    package: match.package,
    presentation: tool.presentation,
    ...(tool.label === undefined ? {} : { label: tool.label })
  });
}

function freezeCommandAdapter(
  match: ExtensionAdapterMatch,
  command: ExtensionAdapterMatch["commands"][number]
): Readonly<ExtensionCommandAdapterView> {
  return Object.freeze({
    adapterId: match.adapterId,
    package: match.package,
    label: command.label,
    ...(command.description === undefined ? {} : { description: command.description })
  });
}

class ImmutableMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #map: Map<Key, Value>;

  constructor(entries: ReadonlyMap<Key, Value>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number { return this.#map.size; }
  get(key: Key): Value | undefined { return this.#map.get(key); }
  has(key: Key): boolean { return this.#map.has(key); }
  entries(): MapIterator<[Key, Value]> { return this.#map.entries(); }
  keys(): MapIterator<Key> { return this.#map.keys(); }
  values(): MapIterator<Value> { return this.#map.values(); }
  [Symbol.iterator](): MapIterator<[Key, Value]> { return this.#map[Symbol.iterator](); }
  forEach(callbackfn: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void {
    this.#map.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
}

function freezeMap<Key, Value>(map: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  return new ImmutableMap(map);
}

export const EMPTY_EXTENSION_ADAPTER_PROJECTION: ExtensionAdapterProjection = emptyProjection();

function emptyProjection(): ExtensionAdapterProjection {
  return Object.freeze({
    matchesByExtension: freezeMap(new Map<string, ExtensionAdapterMatch>()),
    effectiveCommands: freezeMap(new Map<string, Readonly<ExtensionCommandAdapterView>>()),
    effectiveTools: freezeMap(new Map<string, ToolAdapterView>()),
    activeAdapterCount: 0
  });
}
