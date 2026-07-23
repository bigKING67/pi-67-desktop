import type {
  AgentSession,
  AgentSessionServices,
  LoadExtensionsResult,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import type {
  ModelSummary,
  ProviderSummary,
  ResourceSummary,
  SessionSnapshot,
  SessionTreeNodeView
} from "@pi67/domain";
import { normalizeMessages } from "./message-normalizer.js";

export function projectSessionSnapshot(
  session: AgentSession,
  services: AgentSessionServices | undefined,
  extensionsResult: LoadExtensionsResult | undefined
): SessionSnapshot {
  const stats = session.getSessionStats();
  return {
    sessionId: session.sessionId,
    ...(session.sessionFile ? { sessionPath: session.sessionFile } : {}),
    ...(session.sessionName ? { sessionName: session.sessionName } : {}),
    cwd: session.sessionManager.getCwd(),
    streaming: session.isStreaming,
    messages: normalizeMessages(session.messages),
    models: projectModels(session),
    providers: projectProviders(session),
    ...(session.model ? { selectedModel: { provider: session.model.provider, id: session.model.id } } : {}),
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: session.getAvailableThinkingLevels(),
    steeringQueue: [...session.getSteeringMessages()],
    followUpQueue: [...session.getFollowUpMessages()],
    tree: projectSessionTree(session),
    resources: projectResources(services, extensionsResult),
    stats: {
      tokens: stats.tokens.total,
      cost: stats.cost,
      ...(stats.contextUsage?.percent === null || stats.contextUsage?.percent === undefined
        ? {}
        : { contextPercent: stats.contextUsage.percent })
    }
  };
}

function projectModels(session: AgentSession): ModelSummary[] {
  const runtime = session.modelRuntime;
  return runtime.getModels().map((model) => ({
    provider: model.provider,
    id: model.id,
    label: model.name || model.id,
    configured: runtime.hasConfiguredAuth(model.provider),
    contextWindow: model.contextWindow,
    reasoning: model.reasoning
  }));
}

function projectProviders(session: AgentSession): ProviderSummary[] {
  const runtime = session.modelRuntime;
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
    .filter((provider) => provider.modelCount > 0 || provider.configured || provider.id === session.model?.provider)
    .sort((left, right) => {
      if (left.configured !== right.configured) return left.configured ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
}

function projectResources(
  services: AgentSessionServices | undefined,
  extensionsResult: LoadExtensionsResult | undefined
): ResourceSummary[] {
  const resources: ResourceSummary[] = [];
  const loader = services?.resourceLoader;
  if (!loader) return resources;
  for (const skill of loader.getSkills().skills) {
    resources.push({ kind: "skill", id: skill.name, label: skill.name, path: skill.filePath, status: "ready" });
  }
  for (const prompt of loader.getPrompts().prompts) {
    resources.push({ kind: "prompt", id: prompt.name, label: prompt.name, path: prompt.filePath, status: "ready" });
  }
  for (const extension of extensionsResult?.extensions ?? []) {
    resources.push({ kind: "extension", id: extension.resolvedPath, label: extension.path, path: extension.resolvedPath, status: "ready" });
  }
  for (const error of extensionsResult?.errors ?? []) {
    resources.push({ kind: "extension", id: error.path, label: error.path, status: "failed", detail: error.error });
  }
  for (const file of loader.getAgentsFiles().agentsFiles) {
    resources.push({ kind: "context", id: file.path, label: file.path.split(/[\\/]/).pop() ?? file.path, path: file.path, status: "ready" });
  }
  return resources;
}

function projectSessionTree(session: AgentSession): SessionTreeNodeView[] {
  const leafId = session.sessionManager.getLeafId();
  const normalizeNode = (node: ReturnType<SessionManager["getTree"]>[number]): SessionTreeNodeView => {
    const entry = node.entry as unknown as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "unknown";
    return {
      id,
      parentId: typeof entry.parentId === "string" ? entry.parentId : null,
      type: typeof entry.type === "string" ? entry.type : "entry",
      ...(node.label ? { label: node.label } : {}),
      preview: sessionTreePreview(entry),
      active: id === leafId,
      children: node.children.map(normalizeNode)
    };
  };
  return session.sessionManager.getTree().map(normalizeNode);
}

function sessionTreePreview(entry: Record<string, unknown>): string {
  const message = typeof entry.message === "object" && entry.message !== null
    ? entry.message as Record<string, unknown>
    : undefined;
  const content = message?.content ?? entry.summary ?? entry.name ?? entry.type;
  if (typeof content === "string") return content.slice(0, 120);
  try {
    return JSON.stringify(content).slice(0, 120);
  } catch {
    return "Session entry";
  }
}
