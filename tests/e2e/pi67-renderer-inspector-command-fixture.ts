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
  const revisions = new Map<string, string>([
    ["src", "revision-src"],
    ["src/main.ts", "revision-main-1"],
    ["README.md", "revision-readme-1"]
  ]);
  const contents = new Map<string, string>([
    ["src/main.ts", "export const fixture = true;\n"],
    ["README.md", "# Fixture workspace\n"]
  ]);
  (window as FixtureWindow & {
    __pi67ResolveMockInspectorCommand?: MockInspectorCommandHandler;
  }).__pi67ResolveMockInspectorCommand = (type, payload, current) => {
    if (type === "workspace.file.list") return workspaceFilePage(payload, current);
    if (type === "workspace.file.search") return workspaceFileSearch(payload, current);
    if (type === "workspace.file.resolve") return workspaceFileResolve(payload);
    if (type === "workspace.file.open") return workspaceFileOpen(payload);
    if (type === "workspace.file.save") return workspaceFileSave(payload);
    if (type === "message.index") return userMessageIndex(current, payload);
    if (type === "message.locate") return locatedMessageWindow(current, payload);
    return undefined;
  };

  function workspaceFilePage(payload: Record<string, unknown>, current: FixtureAgentState): unknown {
    if (payload.parentId === "fixture-src") return {
      workspaceId: current.workspaceId,
      parentId: "fixture-src",
      entries: [{
        id: "fixture-main-ts",
        name: "main.ts",
        relativePath: "src/main.ts",
        kind: "file",
        revision: revisions.get("src/main.ts"),
        byteLength: 42,
        modifiedAt: 1
      }],
      truncated: false
    };
    return {
      workspaceId: current.workspaceId,
      entries: [
        { id: "fixture-src", name: "src", relativePath: "src", kind: "directory", revision: revisions.get("src"), modifiedAt: 1 },
        { id: "fixture-readme", name: "README.md", relativePath: "README.md", kind: "file", revision: revisions.get("README.md"), byteLength: 24, modifiedAt: 1 }
      ],
      truncated: false
    };
  }

  function workspaceFileSearch(payload: Record<string, unknown>, current: FixtureAgentState): unknown {
    const query = typeof payload.query === "string" ? payload.query : "";
    const candidates = [
      { id: "fixture-main-ts", name: "main.ts", relativePath: "src/main.ts", kind: "file", revision: revisions.get("src/main.ts"), byteLength: 42, modifiedAt: 1 },
      { id: "fixture-readme", name: "README.md", relativePath: "README.md", kind: "file", revision: revisions.get("README.md"), byteLength: 24, modifiedAt: 1 }
    ];
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
    const directory = relativePath === "src";
    return { entry: {
      id: directory ? "fixture-src" : relativePath === "README.md" ? "fixture-readme" : "fixture-main-ts",
      name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
      relativePath,
      kind: directory ? "directory" : "file",
      revision: revisions.get(relativePath) ?? "revision-fixture"
    } };
  }

  function workspaceFileOpen(payload: Record<string, unknown>): unknown {
    const readme = payload.id === "fixture-readme";
    const relativePath = readme ? "README.md" : "src/main.ts";
    const content = contents.get(relativePath) ?? "";
    return {
      id: String(payload.id),
      relativePath,
      kind: "text",
      totalBytes: content.length,
      content,
      revision: revisions.get(relativePath)
    };
  }

  function workspaceFileSave(payload: Record<string, unknown>): unknown {
    const readme = payload.id === "fixture-readme";
    const relativePath = readme ? "README.md" : "src/main.ts";
    if (typeof payload.content !== "string") throw new Error("Mock file content must be a string.");
    const content = payload.content;
    const revision = `${revisions.get(relativePath) ?? "revision"}-saved`;
    contents.set(relativePath, content);
    revisions.set(relativePath, revision);
    return { entry: {
      id: String(payload.id),
      name: relativePath.slice(relativePath.lastIndexOf("/") + 1),
      relativePath,
      kind: "file",
      revision,
      byteLength: content.length,
      modifiedAt: 2
    } };
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
      message.id === anchorId && message.role === "user"
    ));
    if (anchorIndex < 0) throw new Error("Mock user message does not exist.");
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
