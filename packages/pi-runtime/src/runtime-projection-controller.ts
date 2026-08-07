import {
  sessionEntryToContextMessages,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionServices,
  type LoadExtensionsResult,
  type SessionManager,
  type SessionStats
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_USER_MESSAGE_INDEX_PAGE_ITEMS,
  MAX_USER_MESSAGE_INDEX_PAGE_ITEMS,
  type LocatedMessageWindow,
  type ConversationPage,
  type ExtensionCatalogResult,
  type RuntimeCapabilities,
  type RuntimeOperationActivity,
  type SessionSnapshot,
  type SessionTreeProjection,
  type ToolAuthorizationProjection,
  type WorkspaceChangesProjection,
  type UserMessageIndexPage
} from "@pi67/domain";
import {
  ProtocolRequestError,
  type AgentEvent,
  type AssetReadResult,
  type SlashCommandCatalogResult,
  type StreamDelta
} from "@pi67/protocol";
import { ExtensionAdapterRuntime } from "./extension-adapter-runtime.js";
import type { ImageAssetSource } from "./message-normalizer.js";
import { projectMessagePage, type MessagePageOptions } from "./message-projection.js";
import { RuntimeAssetRegistry } from "./runtime-asset-registry.js";
import { SessionEventProjector } from "./session-event-projector.js";
import { SessionProjectionIndex, type SessionProjectionMetadata } from "./session-projection-index.js";
import { projectSessionSnapshot } from "./session-snapshot.js";
import { projectSessionTree } from "./session-tree-projection.js";
import { projectWorkspaceChanges } from "./workspace-change-projection.js";

interface RuntimeProjectionTarget {
  getSession: () => AgentSession;
  getSessionFileIdentity: () => string | undefined;
  getSessionGeneration: () => number;
  emit: (event: AgentEvent) => void;
  emitActivity: (activity: RuntimeOperationActivity) => void;
  getToolAuthorization: (toolCallId: string) => ToolAuthorizationProjection | undefined;
  completeToolAuthorization: (toolCallId: string) => void;
  resetToolAuthorizations: () => void;
  pushStream: (delta: StreamDelta) => void;
  flushStream: () => void;
}

/** Coordinates the disposable views derived from the active Pi Session. */
export class RuntimeProjectionController {
  private readonly session = new SessionProjectionIndex();
  private readonly adapters = new ExtensionAdapterRuntime();
  private readonly assets = new RuntimeAssetRegistry();
  private readonly events: SessionEventProjector;

  constructor(private readonly target: RuntimeProjectionTarget) {
    this.events = new SessionEventProjector({
      getSession: target.getSession,
      getStats: () => this.getStats(target.getSession()),
      emit: target.emit,
      emitActivity: target.emitActivity,
      pushStream: target.pushStream,
      flushStream: target.flushStream,
      bindToolExecutionStart: (toolCallId, toolName) => {
        return this.adapters.bindToolExecutionStart(
          target.getSessionGeneration(),
          toolCallId,
          toolName,
          target.getSession().getAllTools()
        );
      },
      getToolAuthorization: target.getToolAuthorization,
      completeToolExecution: (toolCallId) => {
        this.adapters.completeToolExecution(target.getSessionGeneration(), toolCallId);
        target.completeToolAuthorization(toolCallId);
      },
      settleActiveToolExecutions: () => {
        this.adapters.settleActiveToolExecutions(target.getSessionGeneration());
      }
    });
  }

  async bind(session: AgentSession, extensions: LoadExtensionsResult | undefined): Promise<void> {
    this.session.bind(session.sessionManager);
    this.events.reset();
    this.assets.reset(this.target.getSessionGeneration());
    await this.refreshExtensionAdapters(session, extensions);
  }

  reset(): void {
    this.session.reset();
    this.events.reset();
    this.adapters.reset();
    this.assets.reset(this.target.getSessionGeneration());
    this.target.resetToolAuthorizations();
  }

  resetExtensionAdapters(): void { this.adapters.reset(); }

  refreshExtensionAdapters(
    session: AgentSession,
    extensions: LoadExtensionsResult | undefined
  ): Promise<boolean> {
    return this.adapters.refresh(this.target.getSessionGeneration(), extensions, session);
  }

  observe(session: AgentSession, event: AgentSessionEvent): void {
    this.session.observe(session.sessionManager, event);
    this.events.handle(event);
  }

  recordToolAuthorization(
    toolCallId: string,
    authorization: ToolAuthorizationProjection
  ): void {
    this.events.recordToolAuthorization(toolCallId, authorization);
  }

  getMetadata(manager: SessionManager): SessionProjectionMetadata { return this.session.getMetadata(manager); }
  getStats(session: AgentSession): SessionStats { return this.session.getStats(session); }
  getTree(): SessionTreeProjection { return projectSessionTree(this.session); }
  getCapabilities(): RuntimeCapabilities["extensionUi"] { return this.adapters.getCapabilities(); }
  getCatalog(): ExtensionCatalogResult { return this.adapters.getCatalog(); }
  getCommands(): SlashCommandCatalogResult { return this.adapters.getCommands(); }

  getMessagePage(options: MessagePageOptions): ConversationPage {
    return projectMessagePage(
      this.session,
      options,
      (toolCallId) => this.resolveToolAdapter(toolCallId),
      (source) => this.projectImageAsset(source)
    );
  }

  getUserMessageIndex(options: { offset?: number; limit?: number }): UserMessageIndexPage {
    const items = this.session.getUserMessages();
    const limit = Math.min(
      MAX_USER_MESSAGE_INDEX_PAGE_ITEMS,
      Math.max(1, options.limit ?? DEFAULT_USER_MESSAGE_INDEX_PAGE_ITEMS)
    );
    const offset = options.offset === undefined
      ? Math.max(0, items.length - limit)
      : Math.min(items.length, Math.max(0, options.offset));
    return {
      sessionId: this.session.getSessionId(),
      revision: this.session.getRevision(),
      total: items.length,
      offset,
      items: items.slice(offset, offset + limit)
    };
  }

  locateUserMessage(id: string): LocatedMessageWindow {
    const userMessage = this.session.getUserMessages().find((item) => item.id === id);
    const entryIndex = this.session.findBranchEntryIndex(id);
    if (!userMessage || entryIndex === undefined) throw missingUserMessage();
    const branch = this.session.getBranch();
    let cursor: string | undefined;
    for (let index = entryIndex - 1; index >= 0; index -= 1) {
      const entry = branch[index];
      if (!entry || (entry.type === "custom_message" && !entry.display)) continue;
      if (sessionEntryToContextMessages(entry).length === 0) continue;
      cursor = entry.id;
      break;
    }
    const page = projectMessagePage(
      this.session,
      { direction: "newer", ...(cursor === undefined ? {} : { cursor }), limit: 100 },
      (toolCallId) => this.resolveToolAdapter(toolCallId),
      (source) => this.projectImageAsset(source)
    );
    if (!page.messages.some((message) => message.id === id)) throw missingUserMessage();
    return { ...page, anchorId: id, revision: this.session.getRevision() };
  }

  readAsset(options: {
    assetId: string;
    sessionGeneration: number;
    offset: number;
    length?: number;
  }): AssetReadResult {
    return this.assets.read(options);
  }

  getSnapshot(
    session: AgentSession,
    services: AgentSessionServices | undefined,
    extensions: LoadExtensionsResult | undefined
  ): SessionSnapshot {
    return projectSessionSnapshot(
      session,
      services,
      extensions,
      this.session,
      this.target.getSessionFileIdentity(),
      (toolCallId) => this.resolveToolAdapter(toolCallId),
      (source) => this.projectImageAsset(source)
    );
  }

  getWorkspaceChanges(session: AgentSession): WorkspaceChangesProjection {
    return projectWorkspaceChanges(this.session, session.state.pendingToolCalls, session.isStreaming);
  }

  private resolveToolAdapter(toolCallId: string) {
    return this.adapters.getToolAdapter(this.target.getSessionGeneration(), toolCallId);
  }

  private projectImageAsset(source: ImageAssetSource) {
    return this.assets.register(source);
  }
}

function missingUserMessage(): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "RESOURCE_NOT_FOUND",
    message: "The user message no longer exists in the active Session branch.",
    recoverable: true
  });
}
