import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import {
  MAX_SLASH_COMMAND_ITEMS,
  MAX_SLASH_COMMAND_NAME_CHARS,
  MAX_SLASH_COMMAND_DESCRIPTION_CHARS,
  type ExtensionCommandAdapterView
} from "@pi67/domain";
import type { SlashCommandCatalogResult, SlashCommandDescriptor } from "@pi67/protocol";

export function projectExtensionCommands(
  extensions: LoadExtensionsResult | undefined,
  adapters: ReadonlyMap<string, Readonly<ExtensionCommandAdapterView>> = new Map()
): SlashCommandCatalogResult {
  if (!extensions) return { items: [], total: 0, truncated: false };
  const hiddenSources = new Set(
    extensions.extensions
      .filter((extension) => extension.hidden)
      .flatMap((extension) => [extension.path, extension.resolvedPath, extension.sourceInfo.path])
  );
  const projected: SlashCommandDescriptor[] = extensions.runtime.getCommands()
    .filter((command) => !hiddenSources.has(command.sourceInfo.path))
    .flatMap((command): SlashCommandDescriptor[] => {
      const name = command.name.trim();
      const description = command.description?.trim();
      if (!name || name.length > MAX_SLASH_COMMAND_NAME_CHARS) return [];
      if (description && description.length > MAX_SLASH_COMMAND_DESCRIPTION_CHARS) return [];
      return [{
        name,
        source: command.source,
        ...(description ? { description } : {}),
        ...(command.source !== "extension" || adapters.get(name) === undefined
          ? {}
          : { adapter: adapters.get(name)! })
      }];
    })
    .sort((left, right) => (
      sourceOrder(left.source) - sourceOrder(right.source)
      || left.name.localeCompare(right.name)
    ));
  return {
    items: projected.slice(0, MAX_SLASH_COMMAND_ITEMS),
    total: projected.length,
    truncated: projected.length > MAX_SLASH_COMMAND_ITEMS
  };
}

function sourceOrder(source: SlashCommandDescriptor["source"]): number {
  if (source === "extension") return 0;
  if (source === "prompt") return 1;
  return 2;
}
