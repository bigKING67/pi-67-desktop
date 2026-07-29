import type {
  AgentSession,
  AgentSessionServices,
  LoadExtensionsResult,
  ModelRuntime,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import type {
  ModelSummary,
  ProviderSummary,
  ResourceSummary,
  ExtensionToolAdapterView,
  SessionControlsView,
  SessionModelCatalogView,
  SessionSnapshot
} from "@pi67/domain";
import type { ImageAssetProjector } from "./message-normalizer.js";
import { projectMessagePage } from "./message-projection.js";
import { sanitizeRuntimeText } from "./runtime-redaction.js";
import type { SessionProjectionIndex } from "./session-projection-index.js";
import { projectSessionTree } from "./session-tree-projection.js";

export function projectSessionSnapshot(
  session: AgentSession,
  services: AgentSessionServices | undefined,
  extensionsResult: LoadExtensionsResult | undefined,
  projection: SessionProjectionIndex,
  resolveToolAdapter?: (toolCallId: string) => ExtensionToolAdapterView | undefined,
  projectImageAsset?: ImageAssetProjector
): SessionSnapshot {
  const stats = projection.getStats(session);
  const messagePage = projectMessagePage(projection, {}, resolveToolAdapter, projectImageAsset);
  const controls = projectSessionControls(session);
  const modelCatalog = projectSessionModelCatalog(session);
  return {
    sessionId: session.sessionId,
    ...(session.sessionFile ? { sessionPath: session.sessionFile } : {}),
    ...(session.sessionName ? { sessionName: session.sessionName } : {}),
    cwd: session.sessionManager.getCwd(),
    streaming: session.isStreaming,
    messages: messagePage.messages,
    messagePage: {
      ...(messagePage.startCursor === undefined ? {} : { startCursor: messagePage.startCursor }),
      ...(messagePage.endCursor === undefined ? {} : { endCursor: messagePage.endCursor }),
      hasOlder: messagePage.hasOlder,
      hasNewer: messagePage.hasNewer
    },
    models: modelCatalog.models,
    providers: modelCatalog.providers,
    ...(controls.selectedModel === undefined ? {} : { selectedModel: controls.selectedModel }),
    thinkingLevel: controls.thinkingLevel,
    availableThinkingLevels: modelCatalog.availableThinkingLevels,
    steeringQueue: [...session.getSteeringMessages()],
    followUpQueue: [...session.getFollowUpMessages()],
    tree: projectSessionTree(projection),
    resources: projectSessionResources(services, extensionsResult),
    stats: {
      tokens: stats.tokens.total,
      cost: stats.cost,
      ...(stats.contextUsage?.percent === null || stats.contextUsage?.percent === undefined
        ? {}
        : { contextPercent: stats.contextUsage.percent })
    }
  };
}

export function projectSessionControls(session: AgentSession): SessionControlsView {
  return {
    ...(session.model
      ? { selectedModel: { provider: session.model.provider, id: session.model.id } }
      : {}),
    thinkingLevel: session.thinkingLevel
  };
}

export function projectSessionModelCatalog(session: AgentSession): SessionModelCatalogView {
  return {
    models: projectSessionModels(session),
    providers: projectRuntimeProviders(session.modelRuntime, session.model?.provider),
    availableThinkingLevels: session.getAvailableThinkingLevels()
  };
}

export function projectSessionModels(session: AgentSession): ModelSummary[] {
  return projectRuntimeModels(session.modelRuntime);
}

function projectRuntimeModels(runtime: ModelRuntime): ModelSummary[] {
  return runtime.getModels().map((model) => ({
    provider: model.provider,
    id: model.id,
    label: model.name || model.id,
    configured: runtime.hasConfiguredAuth(model.provider),
    contextWindow: model.contextWindow,
    reasoning: model.reasoning
  }));
}

export function projectRuntimeProviders(
  runtime: ModelRuntime,
  selectedProvider?: string
): ProviderSummary[] {
  const modelCounts = new Map<string, number>();
  for (const model of runtime.getModels()) {
    modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1);
  }

  return runtime.getProviders()
    .map((provider): ProviderSummary => {
      const auth = runtime.getProviderAuthStatus(provider.id);
      return {
        id: provider.id,
        label: provider.name || provider.id,
        configured: auth.configured,
        ...(auth.source ? { credentialSource: auth.source } : {}),
        ...(auth.label ? { credentialLabel: auth.label.slice(0, 120) } : {}),
        modelCount: modelCounts.get(provider.id) ?? 0
      };
    })
    .filter((provider) => provider.modelCount > 0 || provider.configured || provider.id === selectedProvider)
    .sort((left, right) => {
      if (left.configured !== right.configured) return left.configured ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
}

export function projectSessionResources(
  services: AgentSessionServices | undefined,
  extensionsResult: LoadExtensionsResult | undefined
): ResourceSummary[] {
  const resources: ResourceSummary[] = [];
  const loader = services?.resourceLoader;
  if (!loader || !services) return resources;
  for (const skill of loader.getSkills().skills) {
    resources.push({
      kind: "skill",
      id: skill.name,
      label: skill.name,
      path: skill.filePath,
      ...projectResourceSource(skill.sourceInfo),
      status: "ready"
    });
  }
  for (const prompt of loader.getPrompts().prompts) {
    resources.push({
      kind: "prompt",
      id: prompt.name,
      label: `/${prompt.name}`,
      path: prompt.filePath,
      ...projectResourceSource(prompt.sourceInfo),
      status: "ready"
    });
  }
  for (const extension of extensionsResult?.extensions ?? []) {
    if (extension.hidden) continue;
    resources.push({
      kind: "extension",
      id: extension.resolvedPath,
      label: extensionResourceLabel(extension.path, extension.sourceInfo),
      path: extension.resolvedPath,
      ...projectResourceSource(extension.sourceInfo),
      status: "ready"
    });
  }
  for (const error of extensionsResult?.errors ?? []) {
    resources.push({
      kind: "extension",
      id: error.path,
      label: error.path,
      status: "failed",
      detail: sanitizeRuntimeText(error.error)
    });
  }
  for (const file of loader.getAgentsFiles().agentsFiles) {
    const global = isPathWithin(file.path, services.agentDir);
    resources.push({
      kind: "context",
      id: file.path,
      label: file.path.split(/[\\/]/).pop() ?? file.path,
      path: file.path,
      source: file.path,
      scope: global ? "user" : "project",
      origin: "top-level",
      status: "ready"
    });
  }
  return resources;
}

function projectResourceSource(sourceInfo: SourceInfo): Pick<
  ResourceSummary,
  "source" | "scope" | "origin"
> {
  return {
    source: sourceInfo.source,
    scope: sourceInfo.scope,
    origin: sourceInfo.origin
  };
}

function extensionResourceLabel(resourcePath: string, sourceInfo: SourceInfo): string {
  const fileName = resourcePath.split(/[\\/]/).pop() ?? resourcePath;
  if (sourceInfo.origin !== "package" || !sourceInfo.source.startsWith("npm:")) return fileName;
  const packageName = sourceInfo.source.slice(4).trim();
  return packageName ? `${packageName} · ${fileName}` : fileName;
}

export function isPathWithin(
  candidate: string,
  directory: string,
  platform = process.platform
): boolean {
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
    return platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const normalizedCandidate = normalize(candidate);
  const normalizedDirectory = normalize(directory);
  return normalizedCandidate === normalizedDirectory
    || normalizedCandidate.startsWith(`${normalizedDirectory}/`);
}
