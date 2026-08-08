import type {
  FixtureAgentState,
  FixtureMessage,
  FixtureWindow
} from "./pi67-renderer-fixture-types.js";

export type MockInspectorCommandHandler = (
  type: string,
  payload: Record<string, unknown>,
  state: FixtureAgentState
) => unknown;

export function installMockInspectorCommandHandler(): void {
  type Entry = {
    id: string;
    name: string;
    relativePath: string;
    kind: "file" | "directory";
    revision: string;
    byteLength?: number;
    modifiedAt: number;
  };
  const entries = new Map<string, Entry>([
    entry("fixture-src", "src", "directory"),
    entry("fixture-tests", "tests", "directory"),
    entry("fixture-node-modules", "node_modules", "directory"),
    entry("fixture-dependency", "node_modules/dependency", "directory"),
    entry("fixture-main-ts", "src/main.ts", "file", 42),
    entry("fixture-src-index", "src/index.ts", "file", 18),
    entry("fixture-tests-index", "tests/index.ts", "file", 20),
    entry("fixture-generated-index", "node_modules/dependency/index.ts", "file", 24),
    entry("fixture-readme", "README.md", "file", 24)
  ]);
  const contents = new Map<string, string>([
    ["src/main.ts", "export const fixture = true;\n"],
    ["src/index.ts", "export * from './main';\n"],
    ["tests/index.ts", "export const test = true;\n"],
    ["node_modules/dependency/index.ts", "export const generated = true;\n"],
    ["README.md", "# Fixture workspace\n"]
  ]);
  let createdIndex = 0;
  (window as FixtureWindow & {
    __pi67ResolveMockInspectorCommand?: MockInspectorCommandHandler;
  }).__pi67ResolveMockInspectorCommand = (type, payload, current) => {
    if (type === "workspace.file.list") return workspaceFilePage(payload, current);
    if (type === "workspace.file.search") return workspaceFileSearch(payload, current);
    if (type === "workspace.file.resolve") return workspaceFileResolve(payload);
    if (type === "workspace.file.open") return workspaceFileOpen(payload);
    if (type === "workspace.file.save") return workspaceFileSave(payload);
    if (type === "workspace.file.create") return workspaceFileCreate(payload);
    if (type === "workspace.file.rename") return workspaceFileRename(payload);
    if (type === "message.index") return userMessageIndex(current, payload);
    if (type === "message.locate") return locatedMessageWindow(current, payload);
    return undefined;
  };

  function workspaceFilePage(payload: Record<string, unknown>, current: FixtureAgentState): unknown {
    const parent = typeof payload.parentId === "string"
      ? [...entries.values()].find((candidate) => candidate.id === payload.parentId)
      : undefined;
    const parentPath = parent?.relativePath ?? "";
    const includeGenerated = payload.includeGenerated === true;
    return {
      workspaceId: current.workspaceId,
      ...(parent ? { parentId: parent.id } : {}),
      entries: [...entries.values()]
        .filter((candidate) => (
          parentRelativePath(candidate.relativePath) === parentPath
          && !isTrashed(candidate)
          && (includeGenerated || candidate.kind !== "directory" || candidate.name !== "node_modules")
        ))
        .sort(compareEntries),
      truncated: false
    };
  }

  function workspaceFileSearch(payload: Record<string, unknown>, current: FixtureAgentState): unknown {
    const query = typeof payload.query === "string" ? payload.query : "";
    const includeGenerated = payload.includeGenerated === true;
    const candidates = [...entries.values()].filter((candidate) => (
      !isTrashed(candidate)
      && (includeGenerated || !candidate.relativePath.startsWith("node_modules/"))
    ));
    return {
      workspaceId: current.workspaceId,
      query,
      entries: candidates.filter((entry) => (
        entry.relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      )),
      truncated: false,
      visited: candidates.length
    };
  }

  function workspaceFileResolve(payload: Record<string, unknown>): unknown {
    const relativePath = String(payload.relativePath);
    return { entry: entries.get(relativePath) ?? entry("fixture-resolved", relativePath, "file")[1] };
  }

  function workspaceFileOpen(payload: Record<string, unknown>): unknown {
    const candidate = [...entries.values()].find((item) => item.id === payload.id);
    if (!candidate || candidate.kind !== "file") throw new Error("Mock file does not exist.");
    const relativePath = candidate.relativePath;
    const content = contents.get(relativePath) ?? "";
    return {
      id: String(payload.id),
      relativePath,
      kind: "text",
      totalBytes: content.length,
      content,
      revision: candidate.revision
    };
  }

  function workspaceFileSave(payload: Record<string, unknown>): unknown {
    const candidate = [...entries.values()].find((item) => item.id === payload.id);
    if (!candidate || candidate.kind !== "file") throw new Error("Mock file does not exist.");
    const relativePath = candidate.relativePath;
    if (typeof payload.content !== "string") throw new Error("Mock file content must be a string.");
    const content = payload.content;
    const revision = `${candidate.revision}-saved`;
    contents.set(relativePath, content);
    const updated = { ...candidate, revision, byteLength: content.length, modifiedAt: 2 };
    entries.set(relativePath, updated);
    return { entry: updated };
  }

  function workspaceFileCreate(payload: Record<string, unknown>): unknown {
    const parent = typeof payload.parentId === "string"
      ? [...entries.values()].find((candidate) => candidate.id === payload.parentId)
      : undefined;
    const name = String(payload.name);
    const relativePath = parent ? `${parent.relativePath}/${name}` : name;
    const created = entry(
      `fixture-created-${++createdIndex}`,
      relativePath,
      payload.kind === "directory" ? "directory" : "file",
      payload.kind === "directory" ? undefined : 0
    )[1];
    entries.set(relativePath, created);
    if (created.kind === "file") contents.set(relativePath, "");
    return { entry: created };
  }

  function workspaceFileRename(payload: Record<string, unknown>): unknown {
    const candidate = [...entries.values()].find((item) => item.id === payload.id);
    if (!candidate) throw new Error("Mock file does not exist.");
    const previousRelativePath = candidate.relativePath;
    const nextRelativePath = [parentRelativePath(previousRelativePath), String(payload.name)].filter(Boolean).join("/");
    const updated = { ...candidate, name: String(payload.name), relativePath: nextRelativePath, revision: `${candidate.revision}-renamed` };
    entries.delete(previousRelativePath);
    entries.set(nextRelativePath, updated);
    if (candidate.kind === "file") {
      const content = contents.get(previousRelativePath) ?? "";
      contents.delete(previousRelativePath);
      contents.set(nextRelativePath, content);
    }
    return { entry: updated, previousRelativePath };
  }

  function entry(id: string, relativePath: string, kind: "file" | "directory", byteLength?: number): [string, Entry] {
    const value: Entry = {
      id,
      name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
      relativePath,
      kind,
      revision: `revision-${id}`,
      ...(byteLength === undefined ? {} : { byteLength }),
      modifiedAt: 1
    };
    return [relativePath, value];
  }

  function isTrashed(candidate: Entry): boolean {
    const trashes = (window as FixtureWindow & {
      __pi67WorkspaceEntryTest?: { trashes: Array<{ relativePath?: unknown }> };
    }).__pi67WorkspaceEntryTest?.trashes ?? [];
    return trashes.some((trashed) => (
      trashed.relativePath === candidate.relativePath
      || (typeof trashed.relativePath === "string" && candidate.relativePath.startsWith(`${trashed.relativePath}/`))
    ));
  }

  function parentRelativePath(relativePath: string): string {
    const index = relativePath.lastIndexOf("/");
    return index < 0 ? "" : relativePath.slice(0, index);
  }

  function compareEntries(left: Entry, right: Entry): number {
    return Number(right.kind === "directory") - Number(left.kind === "directory")
      || left.name.localeCompare(right.name);
  }

  function userMessageIndex(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const allItems = current.conversationMessages
      .filter((message) => message.role === "user")
      .map((message, index) => ({
        id: message.id,
        ordinal: index + 1,
        preview: message.parts
          .flatMap((part) => part.type === "text" && part.text ? [part.text] : [])
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim()
          .slice(0, 120),
        ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
        imageCount: message.parts.filter((part) => part.type === "image").length,
        attachmentCount: message.parts.filter((part) => part.type === "attachment").length
      }));
    const limit = typeof payload.limit === "number" ? Math.min(200, Math.max(1, payload.limit)) : 100;
    const offset = typeof payload.offset === "number"
      ? Math.min(allItems.length, Math.max(0, payload.offset))
      : Math.max(0, allItems.length - limit);
    return {
      sessionId: String(current.snapshot.sessionId),
      revision: 1,
      total: allItems.length,
      offset,
      items: allItems.slice(offset, offset + limit)
    };
  }

  function locatedMessageWindow(
    current: FixtureAgentState,
    payload: Record<string, unknown>
  ): Record<string, unknown> {
    const anchorId = String(payload.id);
    const anchorIndex = current.conversationMessages.findIndex((message) => (
      message.id === anchorId && (message.role === "user" || message.role === "assistant")
    ));
    if (anchorIndex < 0) throw new Error("Mock conversation message does not exist.");
    const start = Math.max(0, anchorIndex - 20);
    const end = Math.min(current.conversationMessages.length, anchorIndex + 80);
    const messages = current.conversationMessages.slice(start, end);
    return {
      sessionId: String(current.snapshot.sessionId),
      revision: 1,
      anchorId,
      messages,
      ...pageMetadata(messages, start > 0, end < current.conversationMessages.length)
    };
  }

  function pageMetadata(
    messages: FixtureMessage[],
    hasOlder: boolean,
    hasNewer: boolean
  ): Record<string, unknown> {
    return {
      ...(messages[0] === undefined ? {} : { startCursor: messages[0].id }),
      ...(messages.at(-1) === undefined ? {} : { endCursor: messages.at(-1)!.id }),
      hasOlder,
      hasNewer
    };
  }
}
