import { createHash } from "node:crypto";
import type {
  AgentSession,
  AgentSessionServices,
  LoadExtensionsResult,
  ModelRuntime,
  SourceInfo
} from "@earendil-works/pi-coding-agent";
import type {
  ExtensionToolAdapterView,
  ModelSummary,
  ProviderSummary,
  ResourceCatalogProjection,
  ResourceSummary,
  SessionControlsView,
  SessionModelCatalogResult,
  SessionModelCatalogView,
  SessionSnapshot
} from "@pi67/domain";
import {
  MAX_RESOURCE_CATALOG_ITEMS,
  MAX_RESOURCE_CATALOG_TEXT_CHARS,
  MAX_RESOURCE_DETAIL_CHARS,
  MAX_RESOURCE_ID_CHARS,
  MAX_RESOURCE_LABEL_CHARS,
  MAX_RESOURCE_PATH_CHARS,
  MAX_RESOURCE_SOURCE_CHARS
} from "@pi67/domain";
import type { ImageAssetProjector } from "./message-normalizer.js";
import { projectMessagePage } from "./message-projection.js";
import { sanitizeRuntimeText } from "./runtime-redaction.js";
import { runtimeDisplayLabel } from "./runtime-display-label.js";
import type { SessionProjectionIndex } from "./session-projection-index.js";
import { projectSessionTree } from "./session-tree-projection.js";

export function projectSessionSnapshot(
  session: AgentSession,
  services: AgentSessionServices | undefined,
  extensionsResult: LoadExtensionsResult | undefined,
  projection: SessionProjectionIndex,
  sessionFileIdentity?: string,
  resolveToolAdapter?: (toolCallId: string) => ExtensionToolAdapterView | undefined,
  projectImageAsset?: ImageAssetProjector
): SessionSnapshot {
  const stats = projection.getStats(session);
  const messagePage = projectMessagePage(projection, {}, resolveToolAdapter, projectImageAsset);
  const controls = projectSessionControls(session);
  const modelCatalog = projectSessionModelCatalog(session);
  const resourceCatalog = projectSessionResourceCatalog(services, extensionsResult);
  return {
    sessionId: session.sessionId,
    ...(sessionFileIdentity ? { sessionFileIdentity } : {}),
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
    ...resourceCatalog,
    compatibility: projection.getCompatibility(),
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

export function projectSessionModelCatalogResult(session: AgentSession): SessionModelCatalogResult {
  return {
    sessionId: session.sessionId,
    controls: projectSessionControls(session),
    modelCatalog: projectSessionModelCatalog(session)
  };
}

export function projectSessionModels(session: AgentSession): ModelSummary[] {
  return projectRuntimeModels(session.modelRuntime);
}

function projectRuntimeModels(runtime: ModelRuntime): ModelSummary[] {
  return runtime.getModels().map((model) => ({
    provider: model.provider,
    id: model.id,
    label: runtimeDisplayLabel(model.name, model.id),
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
        label: runtimeDisplayLabel(provider.name, provider.id),
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

export function projectSessionResourceCatalog(
  services: AgentSessionServices | undefined,
  extensionsResult: LoadExtensionsResult | undefined
): ResourceCatalogProjection {
  const projection = new ResourceCatalogProjectionBuilder();
  const loader = services?.resourceLoader;
  if (!loader || !services) return projection.finish();
  for (const skill of loader.getSkills().skills) {
    projection.add(() => ({
      kind: "skill",
      id: skill.name,
      label: skill.name,
      path: skill.filePath,
      ...projectResourceSource(skill.sourceInfo),
      status: "ready"
    }));
  }
  for (const prompt of loader.getPrompts().prompts) {
    projection.add(() => ({
      kind: "prompt",
      id: prompt.name,
      label: `/${prompt.name}`,
      path: prompt.filePath,
      ...projectResourceSource(prompt.sourceInfo),
      status: "ready"
    }));
  }
  for (const extension of extensionsResult?.extensions ?? []) {
    if (extension.hidden) continue;
    projection.add(() => ({
      kind: "extension",
      id: extension.resolvedPath,
      label: extensionResourceLabel(extension.path, extension.sourceInfo),
      path: extension.resolvedPath,
      ...projectResourceSource(extension.sourceInfo),
      status: "ready"
    }));
  }
  for (const error of extensionsResult?.errors ?? []) {
    projection.add(() => ({
      kind: "extension",
      id: error.path,
      label: error.path,
      status: "failed",
      detail: error.error
    }));
  }
  for (const file of loader.getAgentsFiles().agentsFiles) {
    const global = isPathWithin(file.path, services.agentDir);
    projection.add(() => ({
      kind: "context",
      id: file.path,
      label: file.path.split(/[\\/]/).pop() ?? file.path,
      path: file.path,
      source: file.path,
      scope: global ? "user" : "project",
      origin: "top-level",
      status: "ready"
    }));
  }
  return projection.finish();
}

class ResourceCatalogProjectionBuilder {
  private readonly resources: ResourceSummary[] = [];
  private totalItems = 0;
  private textChars = 0;
  private truncatedFields = 0;

  add(create: () => ResourceSummary): void {
    this.totalItems += 1;
    if (this.resources.length >= MAX_RESOURCE_CATALOG_ITEMS) return;
    const projected = projectResourceSummary(create());
    if (this.textChars + projected.textChars > MAX_RESOURCE_CATALOG_TEXT_CHARS) return;
    this.resources.push(projected.resource);
    this.textChars += projected.textChars;
    this.truncatedFields += projected.truncatedFields;
  }

  finish(): ResourceCatalogProjection {
    const projectedItems = this.resources.length;
    const omittedItems = this.totalItems - projectedItems;
    return {
      resources: this.resources,
      resourceCatalog: {
        totalItems: this.totalItems,
        projectedItems,
        omittedItems,
        truncatedFields: this.truncatedFields,
        truncated: omittedItems > 0 || this.truncatedFields > 0
      }
    };
  }
}

interface ProjectedResourceSummary {
  resource: ResourceSummary;
  textChars: number;
  truncatedFields: number;
}

function projectResourceSummary(resource: ResourceSummary): ProjectedResourceSummary {
  const fields = {
    id: projectResourceIdentity(resource.id),
    label: projectResourceText(resource.label, MAX_RESOURCE_LABEL_CHARS, "Unnamed resource"),
    ...(resource.path === undefined
      ? {}
      : { path: projectResourceText(resource.path, MAX_RESOURCE_PATH_CHARS) }),
    ...(resource.source === undefined
      ? {}
      : { source: projectResourceText(resource.source, MAX_RESOURCE_SOURCE_CHARS) }),
    ...(resource.detail === undefined
      ? {}
      : { detail: projectResourceText(resource.detail, MAX_RESOURCE_DETAIL_CHARS) })
  };
  const projected: ResourceSummary = {
    kind: resource.kind,
    id: fields.id.text,
    label: fields.label.text,
    ...(fields.path === undefined ? {} : { path: fields.path.text }),
    ...(fields.source === undefined ? {} : { source: fields.source.text }),
    ...(resource.scope === undefined ? {} : { scope: resource.scope }),
    ...(resource.origin === undefined ? {} : { origin: resource.origin }),
    status: resource.status,
    ...(fields.detail === undefined ? {} : { detail: fields.detail.text })
  };
  const boundedFields = Object.values(fields);
  return {
    resource: projected,
    textChars: boundedFields.reduce((total, field) => total + field.text.length, 0),
    truncatedFields: boundedFields.filter((field) => field.truncated).length
  };
}

interface ProjectedResourceText {
  text: string;
  truncated: boolean;
}

function projectResourceIdentity(value: string): ProjectedResourceText {
  const projected = projectResourceText(value, MAX_RESOURCE_ID_CHARS, "unknown-resource");
  if (!projected.truncated) return projected;
  const digest = createHash("sha256").update(value).digest("hex");
  const suffix = `:${digest}`;
  const prefix = projectResourceText(
    value,
    MAX_RESOURCE_ID_CHARS - suffix.length,
    "resource"
  ).text;
  return { text: `${prefix}${suffix}`, truncated: true };
}

function projectResourceText(
  value: string,
  maximum: number,
  fallback = ""
): ProjectedResourceText {
  const preLimit = maximum * 4;
  const preBounded = value.length <= preLimit ? value : value.slice(0, preLimit);
  const sanitized = sanitizeRuntimeText(preBounded, maximum);
  const wellFormed = dropTrailingHighSurrogate(sanitized);
  return {
    text: wellFormed || fallback,
    truncated: value.length > preLimit
      || sanitized.length >= maximum && value.length > maximum
      || wellFormed.length !== sanitized.length
  };
}

function dropTrailingHighSurrogate(value: string): string {
  if (value.length === 0) return value;
  const code = value.charCodeAt(value.length - 1);
  return code >= 0xd800 && code <= 0xdbff ? value.slice(0, -1) : value;
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
