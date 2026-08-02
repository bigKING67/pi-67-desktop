import type {
  AgentSession,
  AgentSessionEvent,
  SessionEntry,
  SessionManager,
  SessionStats,
  SessionTreeNode
} from "@earendil-works/pi-coding-agent";
import {
  MAX_USER_MESSAGE_PREVIEW_CHARS,
  type UserMessageIndexItem
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export interface SessionProjectionMetadata {
  sessionId: string;
  modifiedAt: number;
  messageCount: number;
}

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface ProjectionState {
  manager: SessionManager;
  sessionId: string;
  entries: SessionEntry[];
  entriesById: Map<string, SessionEntry>;
  branch: SessionEntry[];
  branchIndex: Map<string, number>;
  revision: number;
  userMessages: UserMessageIndexItem[];
  leafId: string | null;
  metadata: SessionProjectionMetadata;
  usage: UsageTotals;
  messageStats: Pick<SessionStats, "userMessages" | "assistantMessages" | "toolCalls" | "toolResults" | "totalMessages">;
  tree: SessionTreeNode[];
  treeNodesById: Map<string, SessionTreeNode>;
}

/**
 * Keeps disposable projections of the active Pi Session entries. The SDK remains
 * authoritative; this index prevents each desktop projection from copying and
 * rescanning the same append-only entry array independently.
 */
export class SessionProjectionIndex {
  private state: ProjectionState | undefined;

  bind(manager: SessionManager): void {
    const entries = manager.getEntries();
    this.state = buildState(manager, entries);
  }

  reset(): void {
    this.state = undefined;
  }

  observe(manager: SessionManager, event: AgentSessionEvent): void {
    if (event.type !== "entry_appended") return;
    const state = this.requireState(manager);
    appendEntry(state, event.entry, manager.getLeafId());
  }

  getSessionId(): string {
    return this.requireBoundState().sessionId;
  }

  getLeafId(): string | null {
    return this.synchronizeState().leafId;
  }

  getBranch(): SessionEntry[] {
    return this.synchronizeState().branch;
  }

  getRevision(): number {
    return this.synchronizeState().revision;
  }

  getUserMessages(): UserMessageIndexItem[] {
    return this.synchronizeState().userMessages;
  }

  findBranchEntryIndex(id: string): number | undefined {
    return this.synchronizeState().branchIndex.get(id);
  }

  getTree(): SessionTreeNode[] {
    return this.synchronizeState().tree;
  }

  getMetadata(manager: SessionManager): SessionProjectionMetadata {
    return this.synchronizeState(manager).metadata;
  }

  getStats(session: AgentSession): SessionStats {
    const state = this.synchronizeState(session.sessionManager);
    const usage = state.usage;
    const contextUsage = session.getContextUsage();
    return {
      sessionFile: session.sessionFile,
      sessionId: state.sessionId,
      ...state.messageStats,
      tokens: {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        total: usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      },
      cost: usage.cost,
      ...(contextUsage === undefined ? {} : { contextUsage })
    };
  }

  private requireState(manager: SessionManager): ProjectionState {
    const state = this.requireBoundState();
    if (state.manager !== manager || state.sessionId !== manager.getSessionId()) {
      throw new Error("Session projection index is not bound to the active Pi Session.");
    }
    return state;
  }

  private synchronizeState(manager?: SessionManager): ProjectionState {
    const state = manager === undefined ? this.requireBoundState() : this.requireState(manager);
    const nextLeafId = state.manager.getLeafId();
    if (nextLeafId !== null && !state.entriesById.has(nextLeafId)) {
      const refreshed = buildState(state.manager, state.manager.getEntries());
      this.state = refreshed;
      return refreshed;
    }
    syncBranch(state, nextLeafId);
    return state;
  }

  private requireBoundState(): ProjectionState {
    if (!this.state) throw new Error("Session projection index is not initialized.");
    return this.state;
  }
}

function buildState(manager: SessionManager, entries: SessionEntry[]): ProjectionState {
  const sessionId = manager.getSessionId();
  const headerTime = Date.parse(manager.getHeader()?.timestamp ?? "");
  const state: ProjectionState = {
    manager,
    sessionId,
    entries,
    entriesById: new Map(entries.map((entry) => [entry.id, entry])),
    branch: [],
    branchIndex: new Map(),
    revision: 1,
    userMessages: [],
    leafId: manager.getLeafId(),
    metadata: {
      sessionId,
      modifiedAt: Number.isFinite(headerTime) ? Math.max(0, Math.trunc(headerTime)) : 0,
      messageCount: 0
    },
    usage: emptyUsage(),
    messageStats: emptyMessageStats(),
    ...buildTree(entries)
  };
  for (const entry of entries) accumulateEntry(state, entry);
  rebuildBranch(state);
  return state;
}

function appendEntry(state: ProjectionState, entry: SessionEntry, nextLeafId: string | null): void {
  if (state.entriesById.has(entry.id)) {
    state.leafId = nextLeafId;
    rebuildBranch(state);
    state.revision += 1;
    return;
  }
  const previousLeafId = state.leafId;
  state.entries.push(entry);
  state.entriesById.set(entry.id, entry);
  appendTreeEntry(state, entry);
  accumulateEntry(state, entry);
  state.leafId = nextLeafId;
  if (nextLeafId === entry.id && entry.parentId === previousLeafId) {
    state.branchIndex.set(entry.id, state.branch.length);
    state.branch.push(entry);
    if (isUserMessageEntry(entry)) {
      state.userMessages.push(projectUserMessageIndexItem(
        entry,
        state.userMessages.length + 1,
        state.branch.at(-2)
      ));
    }
  } else {
    rebuildBranch(state);
  }
  state.revision += 1;
}

function syncBranch(state: ProjectionState, nextLeafId = state.manager.getLeafId()): void {
  if (nextLeafId === state.leafId) return;
  state.leafId = nextLeafId;
  rebuildBranch(state);
  state.revision += 1;
}

function rebuildBranch(state: ProjectionState): void {
  const reverse: SessionEntry[] = [];
  const visited = new Set<string>();
  let current = state.leafId === null ? undefined : state.entriesById.get(state.leafId);
  while (current && reverse.length < state.entries.length && !visited.has(current.id)) {
    reverse.push(current);
    visited.add(current.id);
    current = current.parentId === null ? undefined : state.entriesById.get(current.parentId);
  }
  state.branch = reverse.reverse();
  state.branchIndex = new Map(state.branch.map((entry, index) => [entry.id, index]));
  state.userMessages = projectUserMessageIndex(state.branch);
}

function projectUserMessageIndex(branch: SessionEntry[]): UserMessageIndexItem[] {
  const items: UserMessageIndexItem[] = [];
  for (let index = 0; index < branch.length; index += 1) {
    const entry = branch[index];
    if (!entry || !isUserMessageEntry(entry)) continue;
    items.push(projectUserMessageIndexItem(entry, items.length + 1, branch[index - 1]));
  }
  return items;
}

function isUserMessageEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: "message" }> {
  return entry.type === "message" && entry.message.role === "user";
}

function projectUserMessageIndexItem(
  entry: Extract<SessionEntry, { type: "message" }>,
  ordinal: number,
  previous: SessionEntry | undefined
): UserMessageIndexItem {
  const message = entry.message as unknown as { content?: unknown; timestamp?: unknown };
  const content = message.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => {
          if (typeof part !== "object" || part === null) return [];
          const record = part as { type?: unknown; text?: unknown };
          return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
        }).join(" ")
      : "";
  const fallbackImageCount = Array.isArray(content)
    ? content.filter((part) => (
        typeof part === "object" && part !== null && (part as { type?: unknown }).type === "image"
      )).length
    : 0;
  const attachmentCounts = promptAttachmentCounts(previous);
  const timestamp = typeof message.timestamp === "number"
    ? message.timestamp
    : Date.parse(entry.timestamp);
  return {
    id: entry.id,
    ordinal,
    preview: boundedPreview(text),
    ...(Number.isFinite(timestamp) ? { createdAt: Math.max(0, Math.trunc(timestamp)) } : {}),
    imageCount: attachmentCounts?.images ?? fallbackImageCount,
    attachmentCount: attachmentCounts?.attachments ?? 0
  };
}

function promptAttachmentCounts(
  entry: SessionEntry | undefined
): { images: number; attachments: number } | undefined {
  if (
    entry?.type !== "custom_message"
    || entry.customType !== "pi67.desktop-attachments.v1"
    || entry.display
    || typeof entry.details !== "object"
    || entry.details === null
  ) return undefined;
  const attachments = (entry.details as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return undefined;
  let images = 0;
  let nonImages = 0;
  for (const item of attachments.slice(0, 20)) {
    if (typeof item !== "object" || item === null) continue;
    if ((item as { kind?: unknown }).kind === "image") images += 1;
    else nonImages += 1;
  }
  return { images, attachments: nonImages };
}

function boundedPreview(value: string): string {
  const normalized = sanitizeRuntimeText(value)
    .replace(/\s+/gu, " ")
    .trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= MAX_USER_MESSAGE_PREVIEW_CHARS) return normalized;
  return `${codePoints.slice(0, MAX_USER_MESSAGE_PREVIEW_CHARS - 1).join("")}…`;
}

function buildTree(entries: SessionEntry[]): Pick<ProjectionState, "tree" | "treeNodesById"> {
  const labels = new Map<string, { label: string; timestamp: string }>();
  for (const entry of entries) {
    if (entry.type !== "label") continue;
    if (entry.label) labels.set(entry.targetId, { label: entry.label, timestamp: entry.timestamp });
    else labels.delete(entry.targetId);
  }

  const treeNodesById = new Map<string, SessionTreeNode>();
  for (const entry of entries) {
    const label = labels.get(entry.id);
    treeNodesById.set(entry.id, {
      entry,
      children: [],
      ...(label === undefined ? {} : { label: label.label, labelTimestamp: label.timestamp })
    });
  }

  const tree: SessionTreeNode[] = [];
  for (const entry of entries) {
    const node = treeNodesById.get(entry.id);
    if (!node) continue;
    const parent = entry.parentId === null || entry.parentId === entry.id
      ? undefined
      : treeNodesById.get(entry.parentId);
    (parent?.children ?? tree).push(node);
  }
  sortTree(tree);
  return { tree, treeNodesById };
}

function appendTreeEntry(state: ProjectionState, entry: SessionEntry): void {
  if (entry.type === "label") {
    const target = state.treeNodesById.get(entry.targetId);
    if (target) {
      if (entry.label) {
        target.label = entry.label;
        target.labelTimestamp = entry.timestamp;
      } else {
        delete target.label;
        delete target.labelTimestamp;
      }
    }
  }
  const node: SessionTreeNode = { entry, children: [] };
  state.treeNodesById.set(entry.id, node);
  const parent = entry.parentId === null || entry.parentId === entry.id
    ? undefined
    : state.treeNodesById.get(entry.parentId);
  insertByTimestamp(parent?.children ?? state.tree, node);
}

function sortTree(roots: SessionTreeNode[]): void {
  const stack = [...roots];
  roots.sort(compareTreeNodes);
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    node.children.sort(compareTreeNodes);
    stack.push(...node.children);
  }
}

function insertByTimestamp(nodes: SessionTreeNode[], node: SessionTreeNode): void {
  let index = nodes.length;
  while (index > 0 && compareTreeNodes(nodes[index - 1]!, node) > 0) index -= 1;
  nodes.splice(index, 0, node);
}

function compareTreeNodes(left: SessionTreeNode, right: SessionTreeNode): number {
  return Date.parse(left.entry.timestamp) - Date.parse(right.entry.timestamp);
}

function accumulateEntry(state: ProjectionState, entry: SessionEntry): void {
  if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
    addUsage(state.usage, entry.usage);
  }
  if (entry.type !== "message") return;

  state.metadata = accumulateMetadata(state.metadata, entry);
  state.messageStats.totalMessages += 1;
  const message = entry.message;
  if (message.role === "user") {
    state.messageStats.userMessages += 1;
  } else if (message.role === "toolResult") {
    state.messageStats.toolResults += 1;
    if (message.usage) addUsage(state.usage, message.usage);
  } else if (message.role === "assistant") {
    state.messageStats.assistantMessages += 1;
    if (Array.isArray(message.content)) {
      state.messageStats.toolCalls += message.content.filter((part) => part.type === "toolCall").length;
    }
    addUsage(state.usage, message.usage);
  }
}

function accumulateMetadata(metadata: SessionProjectionMetadata, entry: Extract<SessionEntry, { type: "message" }>): SessionProjectionMetadata {
  const timestamp = entry.message.role === "user" || entry.message.role === "assistant"
    ? (typeof entry.message.timestamp === "number" ? entry.message.timestamp : Date.parse(entry.timestamp))
    : Number.NaN;
  return {
    ...metadata,
    modifiedAt: Number.isFinite(timestamp)
      ? Math.max(metadata.modifiedAt, Math.max(0, Math.trunc(timestamp)))
      : metadata.modifiedAt,
    messageCount: metadata.messageCount + 1
  };
}

function emptyUsage(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function emptyMessageStats(): ProjectionState["messageStats"] {
  return { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0 };
}

function addUsage(target: UsageTotals, usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): void {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.cost += usage.cost.total;
}
