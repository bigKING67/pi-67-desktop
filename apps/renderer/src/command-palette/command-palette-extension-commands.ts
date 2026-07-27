import type { ExtensionCommandAdapterView } from "@pi67/domain";
import type { CommandDescriptor } from "@pi67/protocol";
import { MAX_EXTENSION_CANDIDATES } from "./command-palette-model.js";

export function normalizePaletteExtensionCommands(
  values: readonly CommandDescriptor[]
): CommandDescriptor[] | undefined {
  const commands: CommandDescriptor[] = [];
  const names = new Set<string>();
  for (const value of values.slice(0, MAX_EXTENSION_CANDIDATES)) {
    const name = boundedRequiredString(value.name, 160);
    if (!name || names.has(name)) return undefined;
    names.add(name);
    const description = value.description === undefined
      ? undefined
      : boundedRequiredString(value.description, 500);
    if (value.description !== undefined && !description) return undefined;
    const adapter = value.adapter === undefined ? undefined : normalizeAdapter(value.adapter);
    if (value.adapter !== undefined && !adapter) return undefined;
    commands.push({
      name,
      ...(description ? { description } : {}),
      ...(adapter ? { adapter } : {})
    });
  }
  return commands;
}

function normalizeAdapter(value: ExtensionCommandAdapterView): ExtensionCommandAdapterView | undefined {
  const adapterId = boundedRequiredString(value.adapterId, 80);
  const packageName = boundedRequiredString(value.package, 214);
  const label = boundedRequiredString(value.label, 120);
  if (!adapterId || !packageName || !label) return undefined;
  const description = value.description === undefined
    ? undefined
    : boundedRequiredString(value.description, 512);
  if (value.description !== undefined && !description) return undefined;
  return {
    adapterId,
    package: packageName,
    label,
    ...(description ? { description } : {})
  };
}

function boundedRequiredString(value: string, limit: number): string | undefined {
  const normalized = value.trim();
  return normalized && normalized.length <= limit ? normalized : undefined;
}
