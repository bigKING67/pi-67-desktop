import type { LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandAdapterView } from "@pi67/domain";
import type { CommandDescriptor } from "@pi67/protocol";

export function projectExtensionCommands(
  extensions: LoadExtensionsResult | undefined,
  adapters: ReadonlyMap<string, Readonly<ExtensionCommandAdapterView>> = new Map()
): CommandDescriptor[] {
  if (!extensions) return [];
  const hiddenSources = new Set(
    extensions.extensions
      .filter((extension) => extension.hidden)
      .flatMap((extension) => [extension.path, extension.resolvedPath, extension.sourceInfo.path])
  );
  return extensions.runtime.getCommands()
    .filter((command) => command.source === "extension" && !hiddenSources.has(command.sourceInfo.path))
    .map((command) => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      ...(adapters.get(command.name) === undefined ? {} : { adapter: adapters.get(command.name)! })
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
