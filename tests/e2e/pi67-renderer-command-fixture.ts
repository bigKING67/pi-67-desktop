import type { FixtureAgentState, FixtureWindow } from "./pi67-renderer-fixture-types.js";
import { pageMetadata } from "./pi67-renderer-command-page-fixture.js";
import type { MockInspectorCommandHandler } from "./pi67-renderer-inspector-command-fixture.js";
import type { MockSessionControlCommandHandler } from "./pi67-renderer-snapshot-fixture.js";
import type { FixtureSessionCatalogStatus } from "./pi67-session-catalog-fixture.js";
import type { MockContextFileCommandHandler } from "./pi67-context-file-fixture.js";
import type { MockProviderConfigurationCommandHandler } from "./pi67-provider-configuration-command-fixture.js";
import type { MockLarkCommandHandler } from "./pi67-lark-command-fixture.js";
import type { RuntimeDiagnostics } from "../../packages/protocol/src/index.js";

interface MockCommandResponseFixture {
  fixtureExtensionCommands: unknown;
  fixtureRuntimeDiagnostics: RuntimeDiagnostics;
  fixtureSessionCatalogStatus: FixtureSessionCatalogStatus;
}

export type MockCommandResponseHandler = (
  type: string,
  payload: Record<string, unknown>,
  state: FixtureAgentState,
  hostEpoch: number
) => unknown;

export function installMockCommandResponseHandler({
  fixtureExtensionCommands,
  fixtureRuntimeDiagnostics,
  fixtureSessionCatalogStatus
}: MockCommandResponseFixture): void {
  const testWindow = window as FixtureWindow & {
    __pi67ApplyMockSessionControlCommand: MockSessionControlCommandHandler;
    __pi67ResolveMockContextFileCommand: MockContextFileCommandHandler;
    __pi67ResolveMockInspectorCommand: MockInspectorCommandHandler;
    __pi67ResolveMockLarkCommand: MockLarkCommandHandler;
    __pi67ResolveMockProviderConfigurationCommand: MockProviderConfigurationCommandHandler;
    __pi67ResolveMockCommand?: MockCommandResponseHandler;
  };
  const applyMockSessionControlCommand = testWindow.__pi67ApplyMockSessionControlCommand;
  const resolveMockContextFileCommand = testWindow.__pi67ResolveMockContextFileCommand;
  const resolveMockInspectorCommand = testWindow.__pi67ResolveMockInspectorCommand;
  const resolveMockLarkCommand = testWindow.__pi67ResolveMockLarkCommand;
  const resolveMockProviderConfigurationCommand = testWindow.__pi67ResolveMockProviderConfigurationCommand;

  const resolveMockCommand: MockCommandResponseHandler = (type, payload, current, hostEpoch) => {
    const sessionCatalogPage = current.sessionCatalogPagesByWorkspace[current.workspaceId]
      ?? current.sessionCatalogPage;
    if (type === "runtime.getStatus") return { initialized: true, loaded: true };
    const larkResult = resolveMockLarkCommand(type, payload);
    if (larkResult !== undefined) return larkResult;
    if (type === "runtime.initialize" || type === "workspace.open") return {};
    if (
      type === "session.create"
      || type === "session.open"
      || type === "session.fork"
      || type === "session.forkFromTask"
      || type === "session.name"
    ) return {};
    if (type === "workspace.register") return { registered: true };
    if (type === "workspace.unregister") return { unregistered: true };
    if (type === "projection.resync") return {
      sessionId: String(current.snapshot.sessionId),
      sessionFileIdentity: String(current.snapshot.sessionFileIdentity),
      snapshot: current.snapshot,
      changes: current.workspaceChanges,
      extensionCatalog: current.extensionCatalog,
      sessionCatalogStatus: {
        ...fixtureSessionCatalogStatus,
        itemCount: sessionCatalogPage.itemCount
      },
      eventSequence: current.sequence,
      hostEpoch,
      sessionGeneration: current.sessionGeneration,
      taskToolMode: current.taskToolMode,
      ...current.resyncOperations
    };
    if (type === "workspace.changes") return current.workspaceChanges;
    const inspectorResult = resolveMockInspectorCommand(type, payload, current);
    if (inspectorResult !== undefined) return inspectorResult;
    if (type === "extension.catalog.list") return current.extensionCatalog;
    if (type === "extension.package.list") return { items: [], total: 0 };
    if (type === "extension.package.checkUpdates") return { items: [], total: 0 };
    if (type === "extension.package.onboarding.get") return {
      source: payload.source,
      scope: payload.scope,
      state: "suppressed-existing"
    };
    if (type === "extension.package.onboarding.decline") return {
      source: payload.source,
      scope: payload.scope,
      state: "declined"
    };
    if (
      type === "extension.package.install"
      || type === "extension.package.update"
      || type === "extension.package.approveObserved"
      || type === "extension.package.setEnabled"
      || type === "extension.package.restoreInheritance"
      || type === "extension.package.uninstall"
    ) return { changed: true, items: [], total: 0 };
    const contextFileResult = resolveMockContextFileCommand(type, payload, current);
    if (contextFileResult !== undefined) return contextFileResult;
    if (type === "skill.pack.list") return {
      items: mockSkillPacks("not-checked", "bundled"),
      total: 2
    };
    if (type === "skill.pack.checkUpdates") return {
      items: mockSkillPacks("update-available", "bundled"),
      total: 2,
      checkedAt: Date.now()
    };
    if (type === "skill.pack.install") return {
      items: mockSkillPacks("current", "bundled"),
      total: 2,
      checkedAt: Date.now(),
      changed: true
    };
    if (type === "skill.pack.update") return {
      items: mockSkillPacks("current", payload.id === "ai-berkshire-investment-suite" ? "managed" : "bundled"),
      total: 2,
      checkedAt: Date.now(),
      changed: true
    };
    if (type === "skill.pack.restore") return {
      items: mockSkillPacks("not-checked", "bundled"),
      total: 2,
      checkedAt: Date.now(),
      changed: true
    };
    if (type === "session.catalog.query") return sessionCatalogPage;
    if (type === "session.creation.resolve") return {
      status: "missing",
      creationId: typeof payload.creationId === "string" ? payload.creationId : ""
    };
    if (
      type === "session.nameByPath"
      || type === "conversation.pin"
      || type === "conversation.snooze"
      || type === "conversation.archive"
    ) return { revision: sessionCatalogPage.revision + 1 };
    if (type === "message.search") return searchConversation(current, payload);
    if (type === "message.locate") return locateConversationMessage(current, payload);
    if (type === "session.catalog.contentSearch") return {
      workspaceId: current.workspaceId,
      query: typeof payload.query === "string" ? payload.query : "",
      items: [],
      sessionsVisited: sessionCatalogPage.itemCount,
      entriesVisited: 0,
      skippedCount: 0,
      incomplete: false,
      truncated: false
    };
    if (type === "message.page") return conversationPage(current, payload);
    if (type === "session.tree") return current.snapshot.tree;
    if (type === "command.list") return fixtureExtensionCommands;
    if (type === "model.list") return [];
    if (type === "resource.list") {
      return {
        resources: current.snapshot.resources,
        resourceCatalog: current.snapshot.resourceCatalog
      };
    }
    if (type === "provider.list") return current.snapshot.providers;
    if (type === "provider.setRuntimeKey") {
      const configured = applyMockSessionControlCommand("model.setRuntimeKey", payload, current.snapshot);
      if (configured) current.snapshot = configured.snapshot;
      return current.snapshot.providers;
    }
    if (type === "provider.configuration.get" || type === "provider.configuration.reload"
      || type === "provider.projectConfiguration.get" || type === "provider.projectConfiguration.reload") {
      return current.providerConfiguration;
    }
    if (type === "provider.credential.reveal") {
      return payload.provider === "openai"
        ? { provider: "openai", status: "revealed", apiKey: "fixture-persisted-openai-key" }
        : { provider: String(payload.provider), status: "not-found" };
    }
    if (type === "provider.configuration.save") {
      current.providerConfiguration = resolveMockProviderConfigurationCommand(
        "save",
        current.providerConfiguration,
        payload
      );
      return current.providerConfiguration;
    }
    if (type === "provider.configuration.remove") {
      current.providerConfiguration = resolveMockProviderConfigurationCommand(
        "remove",
        current.providerConfiguration,
        payload
      );
      return current.providerConfiguration;
    }
    if (type === "provider.credential.store" || type === "provider.credential.remove") {
      const persistent = type === "provider.credential.store";
      current.providerConfiguration = resolveMockProviderConfigurationCommand(
        "credential",
        current.providerConfiguration,
        payload,
        persistent
      );
      current.snapshot = {
        ...current.snapshot,
        providers: (current.snapshot.providers as Array<Record<string, unknown>>).map((provider) => {
          if (provider.id !== payload.provider) return provider;
          const next: Record<string, unknown> = { ...provider, configured: persistent };
          if (persistent) next.credentialSource = "stored";
          else delete next.credentialSource;
          return next;
        })
      };
      return current.providerConfiguration;
    }
    if (type === "model.default.set") {
      current.providerConfiguration = resolveMockProviderConfigurationCommand(
        "default",
        current.providerConfiguration,
        payload
      );
      return current.providerConfiguration;
    }
    if (type === "model.projectDefault.set") {
      current.providerConfiguration = resolveMockProviderConfigurationCommand(
        "default", current.providerConfiguration, { ...payload, scope: "project" });
      return current.providerConfiguration;
    }
    if (type === "vision.assistant.global.set" || type === "vision.assistant.project.set") {
      const mutation = type === "vision.assistant.global.set" ? "vision-global" : "vision-project";
      current.providerConfiguration = resolveMockProviderConfigurationCommand(mutation,
        current.providerConfiguration, payload);
      return current.providerConfiguration;
    }
    if (
      type === "prompt.submit"
      || type === "plan.implement"
      || type === "session.compact"
      || type === "command.invoke"
      || type === "session.import"
    ) {
      return acceptedOperation(
        current,
        hostEpoch,
        type === "prompt.submit" || type === "plan.implement" || type === "session.compact"
      );
    }
    if (type === "prompt.steer" || type === "prompt.followUp") return { accepted: true };
    if (type === "queue.clear") {
      const steeringCount = (current.snapshot.steeringQueue as unknown[]).length;
      const followUpCount = (current.snapshot.followUpQueue as unknown[]).length;
      current.snapshot = { ...current.snapshot, steeringQueue: [], followUpQueue: [] };
      return { steeringCount, followUpCount, pendingCount: 0 };
    }
    if (type === "operation.abort") {
      return {
        aborted: true,
        ...(typeof payload.operationId === "string" ? { operationId: payload.operationId } : {})
      };
    }
    if (type === "extension.ui.respond") return { resolved: true };
    if (type === "approval.respond") {
      if (payload.decision === "enable-task-yolo-and-allow") current.taskToolMode = "yolo";
      return { resolved: true, taskToolMode: current.taskToolMode };
    }
    if (type === "task.toolMode.set") {
      if (payload.mode !== "ask" && payload.mode !== "auto" && payload.mode !== "yolo") {
        throw new Error("Invalid mock task tool mode.");
      }
      current.taskToolMode = payload.mode;
      return { mode: current.taskToolMode };
    }
    if (type === "task.close") return { closed: true, stopped: payload.mode === "stop" };
    if (type === "doctor.run") return {
      generatedAt: Date.now(),
      checks: [
        { id: "platform", label: "Platform", status: "pass", detail: "darwin/arm64" },
        { id: "node", label: "Embedded Node", status: "pass", detail: "24.18.0" },
        { id: "pi-sdk", label: "Pi SDK", status: "pass", detail: "0.81.1" },
        { id: "shell", label: "Pi shell", status: "pass", detail: "/bin/bash - GNU bash" },
        { id: "git", label: "Git", status: "pass", detail: "git version 2.50.0" }
      ]
    };
    if (type === "diagnostics.collect") return {
      ...fixtureRuntimeDiagnostics,
      generatedAt: Date.now(),
      host: { ...fixtureRuntimeDiagnostics.host!, hostEpoch }
    };
    const controlCommand = applyMockSessionControlCommand(type, payload, current.snapshot);
    if (controlCommand) {
      current.snapshot = controlCommand.snapshot;
      return controlCommand.result;
    }
    throw new Error(`Unhandled mock Agent command: ${type}`);
  };

  function acceptedOperation(
    current: FixtureAgentState,
    hostEpoch: number,
    cancellable: boolean
  ): Record<string, unknown> {
    const operationId = `operation-${++current.operationCounter}`;
    return {
      kind: "accepted",
      operationId,
      cancellable,
      hostEpoch,
      sessionId: String(current.snapshot.sessionId),
      sessionFileIdentity: String(current.snapshot.sessionFileIdentity),
      sessionGeneration: current.sessionGeneration
    };
  }

  function mockSkillPacks(
    status: "not-checked" | "update-available" | "current",
    aiSource: "bundled" | "managed"
  ) {
    const lark = {
      id: "lark-cli-global",
      suiteId: "lark-cli",
      displayName: "飞书 Lark CLI",
      description: "飞书文档、消息、日历、任务、会议和开放平台能力。",
      manager: "lark-cli",
      managerStatus: "ready",
      updateOwner: "managed-pack",
      updateStatus: status,
      localState: status === "not-checked" ? "unknown" : "clean",
      provenance: "verified",
      installed: true,
      installedSkillCount: 2,
      skillIds: ["lark-doc", "lark-calendar"],
      canInstall: false,
      canUpdate: status === "update-available",
      effectiveSource: "managed",
      canRestore: false,
      ...(status === "not-checked" ? {} : {
        installedVersion: status === "current" ? "1.0.80" : "1.0.65",
        installedSkillVersion: "1.0.80",
        latestVersion: "1.0.80"
      }),
      source: "@larksuite/cli",
      detail: status === "current"
        ? "当前 CLI 与官方 Skills 均为 1.0.80。"
        : status === "update-available"
          ? "当前 CLI 1.0.65 待更新；官方 Skills 已是 1.0.80。"
          : "点击检查更新后，由 Lark CLI 验证版本和官方技能同步状态。"
    };
    const aiBerkshire = {
      id: "ai-berkshire-investment-suite",
      suiteId: "ai-berkshire-investment-suite",
      displayName: "AI Berkshire 投资研究",
      description: "公司研究、财务分析和组合管理能力。",
      manager: "pi67-desktop",
      managerStatus: "ready",
      updateOwner: "managed-pack",
      updateStatus: status,
      localState: "clean",
      provenance: "verified",
      installed: true,
      installedSkillCount: 1,
      skillIds: ["investment-research"],
      canInstall: false,
      canUpdate: status === "update-available",
      effectiveSource: aiSource,
      canRestore: aiSource === "managed",
      baselineVersion: "1.0.1",
      installedVersion: aiSource === "managed" ? "1.0.2" : "1.0.1",
      ...(status === "not-checked" ? {} : {
        latestVersion: "1.0.2",
        registryCommit: "7".repeat(40)
      }),
      source: "https://github.com/xbtlin/ai-berkshire",
      detail: aiSource === "managed"
        ? "当前使用 Pi-67 官方 registry 安装的受管 Overlay。"
        : status === "update-available"
          ? "Pi-67 官方 registry 已发布兼容版本 1.0.2，确认后将安装为独立 Overlay。"
          : "当前使用随 Desktop 发布的不可变内置基线。"
    };
    return [lark, aiBerkshire];
  }

  function conversationPage(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const direction = payload.direction === "newer" ? "newer" : "older";
    const limit = typeof payload.limit === "number" ? Math.min(200, Math.max(1, payload.limit)) : 100;
    const cursor = typeof payload.cursor === "string" ? payload.cursor : undefined;
    const cursorIndex = cursor === undefined
      ? undefined
      : current.conversationMessages.findIndex((message) => message.id === cursor);
    const start = direction === "older"
      ? Math.max(0, (cursorIndex ?? current.conversationMessages.length) - limit)
      : cursorIndex === undefined ? 0 : cursorIndex + 1;
    const end = direction === "older"
      ? cursorIndex ?? current.conversationMessages.length
      : Math.min(current.conversationMessages.length, start + limit);
    const messages = current.conversationMessages.slice(start, end);
    return {
      sessionId: String(current.snapshot.sessionId),
      messages,
      ...pageMetadata(messages, start > 0, end < current.conversationMessages.length)
    };
  }

  function searchConversation(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const query = typeof payload.query === "string" ? payload.query : "";
    const normalizedQuery = query.toLocaleLowerCase();
    const items = current.conversationMessages.flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = message.parts
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
      if (!text.toLocaleLowerCase().includes(normalizedQuery)) return [];
      return [{
        id: message.id,
        role: message.role,
        snippet: text.slice(0, 240),
        ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt })
      }];
    });
    return {
      sessionId: String(current.snapshot.sessionId),
      revision: 1,
      query,
      total: items.length,
      items,
      truncated: false
    };
  }

  function locateConversationMessage(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const anchorId = typeof payload.id === "string" ? payload.id : "";
    const anchorIndex = current.conversationMessages.findIndex((message) => message.id === anchorId);
    const start = Math.max(0, anchorIndex - 40);
    const end = Math.min(current.conversationMessages.length, Math.max(anchorIndex + 41, start + 1));
    const messages = current.conversationMessages.slice(start, end);
    return {
      sessionId: String(current.snapshot.sessionId),
      revision: 1,
      anchorId,
      messages,
      ...pageMetadata(messages, start > 0, end < current.conversationMessages.length)
    };
  }

  testWindow.__pi67ResolveMockCommand = resolveMockCommand;
}
