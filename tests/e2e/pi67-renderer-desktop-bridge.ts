import type { Page } from "@playwright/test";
import type {
  ComposerDraftPersistedState,
  NativeNotificationActivation,
  NativeNotificationRequest,
  RuntimeRecoveryRecord,
  SessionCreationRecoveryRecord
} from "../../packages/domain/src/index.js";
import {
  DEFAULT_MOCK_WORKSPACE,
  type MockDesktopBridgeOptions,
  type MockWorkspaceDescriptor
} from "./pi67-renderer-desktop-bridge-contract.js";
import { installMockDesktopCapabilityBridge } from "./pi67-renderer-desktop-capability-bridge.js";
import { installComposerDraftTestControl } from "./pi67-composer-draft-test-control.js";
import { MOCK_DESKTOP_RUNTIME_HEALTH } from "./pi67-runtime-diagnostics-fixture.js";

export {
  DEFAULT_MOCK_WORKSPACE,
  type MockDesktopBridgeOptions,
  type MockWorkspaceDescriptor
} from "./pi67-renderer-desktop-bridge-contract.js";

export async function installMockDesktopBridge(
  page: Page,
  options: MockDesktopBridgeOptions = {}
): Promise<void> {
  const fixture = {
    previousRunExitStatus: options.previousRunExitStatus ?? "clean",
    initialWorkspaces: options.initialWorkspaces ?? [],
    pickerQueue: options.pickerQueue ?? [DEFAULT_MOCK_WORKSPACE],
    initialRuntimeRecovery: options.initialRuntimeRecovery ?? [],
    initialSessionCreationRecovery: options.initialSessionCreationRecovery ?? [],
    initialComposerDraftState: options.initialComposerDraftState ?? {
      version: 1 as const,
      drafts: []
    },
    composerDraftPersistence: options.composerDraftPersistence ?? "available" as const,
    composerDraftUpdateDelayMs: options.composerDraftUpdateDelayMs ?? 0,
    composerDraftFailureCalls: options.composerDraftFailureCalls ?? [],
    composerDraftFailFirstPromptStashWrite: options.composerDraftFailFirstPromptStashWrite ?? false,
    expandedWorkspaceIds: options.expandedWorkspaceIds ?? [],
    currentWorkspaceId: options.currentWorkspaceId,
    selectedSurface: options.selectedSurface,
    settings: options.settings ?? { section: "general" as const, scope: "global" as const },
    deferInitialUpdateState: options.deferInitialUpdateState ?? false,
    repositoryEnvironmentSnapshot: options.repositoryEnvironmentSnapshot,
    runtimeHealth: MOCK_DESKTOP_RUNTIME_HEALTH
  };
  await installMockDesktopCapabilityBridge(
    page,
    options.capabilityInitializingCalls === undefined
      ? {}
      : { capabilityInitializingCalls: options.capabilityInitializingCalls }
  );
  await installComposerDraftTestControl(page);
  await page.addInitScript((bridgeFixture) => {
    // Dev-mode module graphs can exceed Chromium's default 250-entry buffer.
    performance.setResourceTimingBufferSize(2_048);
    type FixtureWorkbenchState = {
      version: 5;
      workspaces: MockWorkspaceDescriptor[];
      workspaceOrder: string[];
      expandedWorkspaceIds: string[];
      currentWorkspaceId?: string;
      selectedSurface?: MockDesktopBridgeOptions["selectedSurface"];
      runtimeRecovery: RuntimeRecoveryRecord[];
      sessionCreationRecovery: SessionCreationRecoveryRecord[];
      workspaceEnvironments: Array<{
        workspaceId: string;
        kind: "plain";
        ownership: "user";
      }>;
      environmentMutations: [];
      settings: NonNullable<MockDesktopBridgeOptions["settings"]>;
      cleanExit: boolean;
    };
    let pickerIndex = 0;
    let promptAttachmentCounter = 0;
    let updateState: Record<string, unknown> = {
      phase: "idle",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      automaticChecks: true
    };
    const updateListeners = new Set<(state: unknown) => void>();
    let resolveInitialUpdateState: (() => void) | undefined;
    const initialUpdateStateGate = bridgeFixture.deferInitialUpdateState
      ? new Promise<void>((resolve) => { resolveInitialUpdateState = resolve; })
      : Promise.resolve();
    const updateTest = {
      checks: 0,
      openedUrls: [] as string[],
      allowOpen: false,
      finishInitialRead() {
        resolveInitialUpdateState?.();
        resolveInitialUpdateState = undefined;
      },
      emit(state: Record<string, unknown>) {
        updateState = structuredClone(state);
        for (const listener of updateListeners) listener(structuredClone(updateState));
      }
    };
    let workspaceFileState = { version: 1 as const, workspaces: [] as Array<Record<string, unknown>> };
    let composerDraftState: ComposerDraftPersistedState = structuredClone(
      bridgeFixture.initialComposerDraftState
    );
    let nativeNotificationActivationListener: ((activation: NativeNotificationActivation) => void) | undefined;
    const composerDraftTest = (window as unknown as {
      __pi67ComposerDraftTest: {
        beforeUpdate(): Promise<void>;
        setStateReader(reader: () => ComposerDraftPersistedState): void;
        updates: number;
      };
    }).__pi67ComposerDraftTest;
    composerDraftTest.setStateReader(() => structuredClone(composerDraftState));
    let composerDraftPromptStashFailureConsumed = false;
    const worktreeTest = {
      createCalls: 0,
      advanceCalls: 0,
      rollbackCalls: 0
    };
    const nativeNotificationTest = {
      requests: [] as NativeNotificationRequest[],
      dismissed: [] as string[],
      activate(activation: NativeNotificationActivation) {
        nativeNotificationActivationListener?.(structuredClone(activation));
      }
    };
    const workspaceEntryTest = {
      menus: [] as Array<Record<string, unknown>>,
      menuManagement: [] as boolean[],
      reveals: [] as Array<Record<string, unknown>>,
      defaultOpens: [] as Array<Record<string, unknown>>,
      copies: [] as Array<{ entry: Record<string, unknown>; kind: "absolute" | "relative" }>,
      trashes: [] as Array<Record<string, unknown>>
    };
    let workbenchState: FixtureWorkbenchState = {
      version: 5 as const,
      workspaces: structuredClone(bridgeFixture.initialWorkspaces),
      workspaceOrder: bridgeFixture.initialWorkspaces.map((workspace) => workspace.id),
      expandedWorkspaceIds: structuredClone(bridgeFixture.expandedWorkspaceIds),
      ...(bridgeFixture.currentWorkspaceId ? { currentWorkspaceId: bridgeFixture.currentWorkspaceId } : {}),
      ...(bridgeFixture.selectedSurface ? { selectedSurface: structuredClone(bridgeFixture.selectedSurface) } : {}),
      runtimeRecovery: structuredClone(bridgeFixture.initialRuntimeRecovery),
      sessionCreationRecovery: structuredClone(bridgeFixture.initialSessionCreationRecovery),
      workspaceEnvironments: bridgeFixture.initialWorkspaces.map((workspace) => ({
        workspaceId: workspace.id,
        kind: "plain" as const,
        ownership: "user" as const
      })),
      environmentMutations: [],
      settings: structuredClone(bridgeFixture.settings),
      cleanExit: false
    };
    type SystemFixtureRegistry = { methods: Record<string, unknown> };
    const fixtureWindow = window as unknown as {
      __pi67SystemFixture?: SystemFixtureRegistry;
    };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    Object.assign(systemFixture.methods, {
          connectAgentHost: async () => undefined,
          loadWorkbenchState: async () => structuredClone(workbenchState),
          inspectRepositoryEnvironment: async ({ workspaceId }: { workspaceId: string }) => ({
            ...(bridgeFixture.repositoryEnvironmentSnapshot
              ? structuredClone(bridgeFixture.repositoryEnvironmentSnapshot)
              : {
                  workspaceId,
                  status: "non-git" as const,
                  revision: 1,
                  observedAt: Date.now(),
                  stale: false,
                  worktrees: []
                }),
            workspaceId
          }),
          createWorktreeEnvironment: async () => {
            worktreeTest.createCalls += 1;
            return {
              status: "rejected" as const,
              error: {
                stage: "preflight" as const,
                code: "repository-not-ready" as const,
                recoverable: true
              }
            };
          },
          advanceWorktreeEnvironment: async () => {
            worktreeTest.advanceCalls += 1;
            return {
              status: "rejected" as const,
              error: {
                stage: "state" as const,
                code: "recovery-required" as const,
                recoverable: true
              }
            };
          },
          rollbackWorktreeEnvironment: async () => {
            worktreeTest.rollbackCalls += 1;
            return {
              status: "rejected" as const,
              error: {
                stage: "state" as const,
                code: "recovery-required" as const,
                recoverable: true
              }
            };
          },
          loadComposerDraftState: async () => ({
            state: structuredClone(composerDraftState),
            persistence: bridgeFixture.composerDraftPersistence
          }),
          updateComposerDraftState: async (state: ComposerDraftPersistedState) => {
            await composerDraftTest.beforeUpdate();
            if (bridgeFixture.composerDraftUpdateDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, bridgeFixture.composerDraftUpdateDelayMs));
            }
            if (bridgeFixture.composerDraftFailureCalls.includes(composerDraftTest.updates)) {
              throw new Error(`Mock Composer draft update ${composerDraftTest.updates} failed.`);
            }
            if (bridgeFixture.composerDraftFailFirstPromptStashWrite
              && !composerDraftPromptStashFailureConsumed
              && state.drafts.some((draft) => (draft.promptStash?.length ?? 0) > 0)) {
              composerDraftPromptStashFailureConsumed = true;
              throw new Error("Mock Prompt Stash draft update failed.");
            }
            composerDraftState = structuredClone(state);
            return {
              state: structuredClone(composerDraftState),
              persistence: bridgeFixture.composerDraftPersistence
            };
          },
          loadWorkspaceFileState: async () => ({
            state: structuredClone(workspaceFileState),
            draftPersistence: "available" as const
          }),
          updateWorkspaceFileState: async (state: typeof workspaceFileState) => {
            workspaceFileState = structuredClone(state);
            return { state: structuredClone(workspaceFileState), draftPersistence: "available" as const };
          },
          updateWorkbenchLayout: async (layout: Record<string, unknown>) => {
            workbenchState = { ...workbenchState, ...structuredClone(layout) } as FixtureWorkbenchState;
            return structuredClone(workbenchState);
          },
          pickAndAddWorkspace: async () => {
            const workspace = bridgeFixture.pickerQueue[
              Math.min(pickerIndex, Math.max(bridgeFixture.pickerQueue.length - 1, 0))
            ];
            if (!workspace) return undefined;
            pickerIndex += 1;
            if (!workbenchState.workspaces.some((item) => item.id === workspace.id)) {
              workbenchState = {
                ...workbenchState,
                workspaces: [...workbenchState.workspaces, workspace],
                workspaceOrder: [...workbenchState.workspaceOrder, workspace.id],
                expandedWorkspaceIds: [...workbenchState.expandedWorkspaceIds, workspace.id],
                workspaceEnvironments: [
                  ...workbenchState.workspaceEnvironments,
                  { workspaceId: workspace.id, kind: "plain", ownership: "user" }
                ],
                currentWorkspaceId: workspace.id
              };
            }
            return structuredClone(workspace);
          },
          removeWorkspace: async (workspaceId: string) => {
            const workspaceOrder = workbenchState.workspaceOrder.filter((id) => id !== workspaceId);
            const currentWorkspaceId = workbenchState.currentWorkspaceId === workspaceId
              ? workspaceOrder[0]
              : workbenchState.currentWorkspaceId;
            const selectedSurface = selectedWorkspaceId(workbenchState.selectedSurface) === workspaceId
              ? (currentWorkspaceId ? { kind: "workspace" as const, workspaceId: currentWorkspaceId } : undefined)
              : workbenchState.selectedSurface;
            workbenchState = {
              version: 5,
              workspaces: workbenchState.workspaces.filter((item) => item.id !== workspaceId),
              workspaceOrder,
              expandedWorkspaceIds: workbenchState.expandedWorkspaceIds.filter((id) => id !== workspaceId),
              ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
              ...(selectedSurface ? { selectedSurface } : {}),
              runtimeRecovery: workbenchState.runtimeRecovery.filter((record) => (
                record.conversation.workspaceId !== workspaceId
              )),
              sessionCreationRecovery: workbenchState.sessionCreationRecovery.filter((record) => (
                record.workspaceId !== workspaceId
              )),
              workspaceEnvironments: workbenchState.workspaceEnvironments.filter((binding) => (
                binding.workspaceId !== workspaceId
              )),
              environmentMutations: [],
              settings: workbenchState.settings.workspaceId === workspaceId
                ? { section: workbenchState.settings.section, scope: "global" }
                : workbenchState.settings,
              cleanExit: false
            };
            composerDraftState = {
              version: 1,
              drafts: composerDraftState.drafts.filter((draft) => (
                draft.conversation.workspaceId !== workspaceId
              )),
              ...(composerDraftState.selectedConversation?.workspaceId === workspaceId
                ? {}
                : composerDraftState.selectedConversation
                  ? { selectedConversation: composerDraftState.selectedConversation }
                  : {})
            };
            return structuredClone(workbenchState);
          },
          reorderWorkspaces: async (workspaceIds: string[]) => {
            workbenchState = { ...workbenchState, workspaceOrder: [...workspaceIds] };
            return structuredClone(workbenchState);
          },
          selectWorkspace: async () => (
            bridgeFixture.pickerQueue[Math.min(pickerIndex, Math.max(bridgeFixture.pickerQueue.length - 1, 0))]
              ?.identity.canonicalPath
          ),
          selectSessionFile: async () => "/Users/test/.pi/agent/sessions/demo.jsonl",
          getRecoverySnapshot: async () => ({
            generatedAt: Date.now(),
            previousRunExitStatus: bridgeFixture.previousRunExitStatus,
            workspaces: {
              total: workbenchState.workspaces.length,
              available: workbenchState.workspaces.filter((workspace) => workspace.availability === "available").length,
              missing: workbenchState.workspaces.filter((workspace) => workspace.availability === "missing").length,
              identityChanged: workbenchState.workspaces.filter((workspace) => workspace.availability === "identity-changed").length,
              needsConfirmation: workbenchState.workspaces.filter((workspace) => workspace.availability === "needs-confirmation").length,
              unavailable: workbenchState.workspaces.filter((workspace) => workspace.availability === "unavailable").length,
              trusted: workbenchState.workspaces.filter((workspace) => workspace.trust === "trusted").length,
              trustUnknown: workbenchState.workspaces.filter((workspace) => workspace.trust === "unknown").length,
              pathOnlyIdentity: workbenchState.workspaces.filter((workspace) => workspace.identity.assurance === "path-only").length
            },
            pendingSessionCreations: workbenchState.sessionCreationRecovery.length,
            attachmentStaging: { draftCount: 0, claimedCount: 0, invalidEntryCount: 0, truncated: false },
            health: bridgeFixture.runtimeHealth
          }),
          saveDiagnostics: async () => "/tmp/pi67-diagnostics.json",
          showNativeNotification: async (request: NativeNotificationRequest) => {
            nativeNotificationTest.requests.push(structuredClone(request));
            return true;
          },
          dismissNativeNotification: async (notificationId: string) => {
            nativeNotificationTest.dismissed.push(notificationId);
            return true;
          },
          onNativeNotificationActivated: (listener: (activation: NativeNotificationActivation) => void) => {
            nativeNotificationActivationListener = listener;
            return () => {
              if (nativeNotificationActivationListener === listener) {
                nativeNotificationActivationListener = undefined;
              }
            };
          },
          stagePromptAttachments: async (files: File[]) => files.map((file) => ({
            id: `fixture_attachment_${++promptAttachmentCounter}`,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            byteLength: file.size,
            kind: promptAttachmentKind(file)
          })),
          releasePromptAttachments: async () => undefined,
          requestOpenExternal: async (url: string) => {
            updateTest.openedUrls.push(url);
            return updateTest.allowOpen;
          },
          showWorkspaceEntryContextMenu: async (entry: Record<string, unknown>, includeManagement = false) => {
            workspaceEntryTest.menus.push(structuredClone(entry));
            workspaceEntryTest.menuManagement.push(includeManagement);
            return entry.kind === "file" ? "pi67-open" as const : "reveal" as const;
          },
          revealWorkspaceEntry: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.reveals.push(structuredClone(entry));
            return true;
          },
          openWorkspaceEntryInDefaultApp: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.defaultOpens.push(structuredClone(entry));
            return true;
          },
          copyWorkspaceEntryPath: async (
            entry: Record<string, unknown>,
            kind: "absolute" | "relative"
          ) => {
            workspaceEntryTest.copies.push({ entry: structuredClone(entry), kind });
            return true;
          },
          trashWorkspaceEntry: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.trashes.push(structuredClone(entry));
            return true;
          },
          getUpdateState: async () => {
            await initialUpdateStateGate;
            return structuredClone(updateState);
          },
          checkForUpdates: async () => {
            updateTest.checks += 1;
            updateState = {
              phase: "available",
              channel: "unsigned-preview",
              currentVersion: "0.1.0-alpha.1",
              version: "0.1.0-alpha.2",
              releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
              publishedAt: "2026-07-23T06:00:00.000Z",
              automaticChecks: true,
              checkedAt: "2026-08-03T08:00:00.000Z"
            };
            for (const listener of updateListeners) listener(structuredClone(updateState));
            return structuredClone(updateState);
          },
          onUpdateStateChanged: (listener: (state: unknown) => void) => {
            updateListeners.add(listener);
            return () => {
              updateListeners.delete(listener);
            };
          },
          onAgentHostFailed: () => () => undefined,
          onPowerResume: () => () => undefined
    });
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: { system: systemFixture.methods }
    });
    Object.defineProperty(window, "__pi67UpdateTest", {
      configurable: false,
      value: updateTest
    });
    Object.defineProperty(window, "__pi67WorkspaceEntryTest", {
      configurable: false,
      value: workspaceEntryTest
    });
    Object.defineProperty(window, "__pi67WorktreeTest", {
      configurable: false,
      value: worktreeTest
    });
    Object.defineProperty(window, "__pi67NativeNotificationTest", {
      configurable: false,
      value: nativeNotificationTest
    });

    function selectedWorkspaceId(surface: FixtureWorkbenchState["selectedSurface"]): string | undefined {
      if (surface?.kind === "workspace") return surface.workspaceId;
      if (surface?.kind === "conversation") return surface.conversation.workspaceId;
      return undefined;
    }

    function promptAttachmentKind(file: File) {
      const type = file.type.toLowerCase();
      const name = file.name.toLowerCase();
      if (type.startsWith("image/")) return "image";
      if (type.startsWith("audio/")) return "audio";
      if (type.startsWith("video/")) return "video";
      if (/zip|gzip|tar|7z|rar/u.test(type) || /\.(?:zip|tar|tgz|gz)$/u.test(name)) return "archive";
      if (type.startsWith("text/") || /pdf|word|excel|spreadsheet|presentation|opendocument|rtf|epub/u.test(type)) {
        return "document";
      }
      return "file";
    }

  }, fixture);
}
