import type { AgentSession, LoadExtensionsResult, ToolInfo } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionCatalogResult,
  ExtensionToolAdapterView,
  RuntimeCapabilities,
  ToolPresentationKind
} from "@pi67/domain";
import {
  BUILTIN_EXTENSION_ADAPTER_MANIFESTS,
  createExtensionAdapterRegistry,
  type ExtensionAdapterRegistry
} from "@pi67/extension-compat";
import type { CommandDescriptor } from "@pi67/protocol";
import {
  EMPTY_EXTENSION_ADAPTER_PROJECTION,
  projectExtensionAdapterProjection,
  type ExtensionAdapterProjection
} from "./extension-adapter-projection.js";
import { getDesktopExtensionUiCapabilities } from "./extension-capabilities.js";
import { projectExtensionCatalog } from "./extension-catalog.js";
import { projectExtensionCommands } from "./extension-commands.js";
import { ToolAttributionRegistry } from "./tool-attribution.js";

const EMPTY_EXTENSION_CATALOG_ITEMS: ExtensionCatalogResult["items"] = [];
Object.freeze(EMPTY_EXTENSION_CATALOG_ITEMS);
const EMPTY_EXTENSION_CATALOG: ExtensionCatalogResult = Object.freeze({
  items: EMPTY_EXTENSION_CATALOG_ITEMS,
  total: 0,
  truncated: false
});

/** Owns the disposable, generation-scoped projection of declarative Extension adapters. */
export class ExtensionAdapterRuntime {
  private projection: ExtensionAdapterProjection = EMPTY_EXTENSION_ADAPTER_PROJECTION;
  private catalog: ExtensionCatalogResult = EMPTY_EXTENSION_CATALOG;
  private commands: CommandDescriptor[] = [];
  private readonly toolAttribution = new ToolAttributionRegistry();
  private refreshRevision = 0;

  constructor(
    private readonly registry: ExtensionAdapterRegistry = createExtensionAdapterRegistry(
      BUILTIN_EXTENSION_ADAPTER_MANIFESTS
    )
  ) {}

  async refresh(
    sessionGeneration: number,
    extensions: LoadExtensionsResult | undefined,
    session: AgentSession | undefined
  ): Promise<boolean> {
    const revision = ++this.refreshRevision;
    const runtimeTools = session?.getAllTools() ?? [];
    const projection = await projectExtensionAdapterProjection(
      extensions,
      session ? { getAllTools: () => runtimeTools } : undefined,
      this.registry
    );
    const catalog = projectExtensionCatalog(extensions, projection.matchesByExtension);
    const commands = projectExtensionCommands(extensions, projection.effectiveCommands);
    if (revision !== this.refreshRevision) return false;

    this.projection = projection;
    this.catalog = catalog;
    this.commands = commands;
    this.toolAttribution.replaceEffectiveTools(sessionGeneration, runtimeTools, projection.effectiveTools);
    return true;
  }

  reset(): void {
    this.refreshRevision += 1;
    this.projection = EMPTY_EXTENSION_ADAPTER_PROJECTION;
    this.catalog = EMPTY_EXTENSION_CATALOG;
    this.commands = [];
    this.toolAttribution.reset();
  }

  getCapabilities(): RuntimeCapabilities["extensionUi"] {
    return getDesktopExtensionUiCapabilities({
      available: true,
      supportedSurfaces: ["commands", "tools"],
      activeAdapterCount: this.projection.activeAdapterCount
    });
  }

  getCatalog(): ExtensionCatalogResult { return this.catalog; }
  getCommands(): CommandDescriptor[] { return this.commands; }

  bindToolExecutionStart(
    sessionGeneration: number,
    toolCallId: string,
    toolName: string,
    runtimeTools: readonly ToolInfo[]
  ): ToolPresentationKind {
    return this.toolAttribution.bindToolExecutionStart(
      sessionGeneration,
      toolCallId,
      toolName,
      runtimeTools
    )?.toolKind ?? "generic";
  }

  completeToolExecution(sessionGeneration: number, toolCallId: string): void {
    this.toolAttribution.completeToolExecution(sessionGeneration, toolCallId);
  }

  settleActiveToolExecutions(sessionGeneration: number): void {
    this.toolAttribution.settleActiveToolExecutions(sessionGeneration);
  }

  getToolAdapter(sessionGeneration: number, toolCallId: string): ExtensionToolAdapterView | undefined {
    return this.toolAttribution.peekToolExecution(sessionGeneration, toolCallId)?.adapter;
  }
}
