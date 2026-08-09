import { open, readdir } from "node:fs/promises";
import {
  MAX_WORKSPACE_CONTENT_SEARCH_BYTES,
  MAX_WORKSPACE_CONTENT_SEARCH_FILE_BYTES,
  MAX_WORKSPACE_CONTENT_SEARCH_FILES,
  MAX_WORKSPACE_CONTENT_SEARCH_LINE_CHARS,
  MAX_WORKSPACE_CONTENT_SEARCH_RESULTS,
  MAX_WORKSPACE_CONTENT_SEARCH_SNIPPET_CHARS,
  WORKSPACE_CONTENT_SEARCH_DEADLINE_MS,
  type WorkspaceFileContentSearchMatch,
  type WorkspaceFileEntry
} from "@pi67/domain";
import type { AgentCommand, CommandResults, WorkspaceProtocolContext } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import {
  isGitMetadataPath,
  joinWorkspaceRelativePath,
  safeWorkspaceFileByteLength,
  type WorkspaceFileAccess
} from "./workspace-file-access.js";
import { WORKSPACE_GENERATED_DIRECTORIES } from "./workspace-file-search-policy.js";

type WorkspaceContentSearchPayload = AgentCommand<"workspace.file.contentSearch">["payload"];

export async function searchWorkspaceFileContent(
  access: WorkspaceFileAccess,
  context: WorkspaceProtocolContext,
  payload: WorkspaceContentSearchPayload,
  signal?: AbortSignal
): Promise<CommandResults["workspace.file.contentSearch"]> {
  const workspace = access.requireTrustedWorkspace(context.workspaceId);
  const query = payload.query.trim();
  if (!query) {
    throw new HostCommandError("INVALID_PAYLOAD", "A Workspace content search query is required.", false);
  }
  const needle = payload.caseSensitive ? query : foldContentSearchText(query).text;
  const matches: WorkspaceFileContentSearchMatch[] = [];
  const directories = [""];
  const deadline = Date.now() + WORKSPACE_CONTENT_SEARCH_DEADLINE_MS;
  let filesVisited = 0;
  let bytesVisited = 0;
  let skippedCount = 0;
  let incomplete = false;

  while (
    directories.length > 0
    && matches.length < MAX_WORKSPACE_CONTENT_SEARCH_RESULTS
    && filesVisited < MAX_WORKSPACE_CONTENT_SEARCH_FILES
    && bytesVisited < MAX_WORKSPACE_CONTENT_SEARCH_BYTES
  ) {
    if (signal?.aborted) throw connectionClosedDuringSearch();
    if (Date.now() >= deadline) {
      incomplete = true;
      break;
    }
    const directoryRelativePath = directories.shift();
    if (directoryRelativePath === undefined) break;
    const directory = await access.resolveContainedPath(
      workspace.canonicalCwd,
      directoryRelativePath,
      "directory"
    );
    let names: string[];
    try {
      names = await readdir(directory.path);
    } catch {
      skippedCount += 1;
      incomplete = true;
      continue;
    }
    names.sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      if (signal?.aborted) throw connectionClosedDuringSearch();
      if (
        Date.now() >= deadline
        || matches.length >= MAX_WORKSPACE_CONTENT_SEARCH_RESULTS
        || filesVisited >= MAX_WORKSPACE_CONTENT_SEARCH_FILES
        || bytesVisited >= MAX_WORKSPACE_CONTENT_SEARCH_BYTES
      ) {
        incomplete = true;
        break;
      }
      const relativePath = joinWorkspaceRelativePath(directoryRelativePath, name);
      let entry: WorkspaceFileEntry;
      try {
        entry = await access.projectEntry(
          context.workspaceId,
          workspace.canonicalCwd,
          directoryRelativePath,
          name
        );
      } catch {
        skippedCount += 1;
        incomplete = true;
        continue;
      }
      const skipDirectory = entry.kind === "directory" && (
        name === ".git" || (!payload.includeGenerated && WORKSPACE_GENERATED_DIRECTORIES.has(name))
      );
      if (entry.kind === "directory") {
        if (!skipDirectory) directories.push(relativePath);
        continue;
      }
      if (entry.kind !== "file" || isGitMetadataPath(relativePath)) continue;

      filesVisited += 1;
      const projectedBytes = entry.byteLength ?? 0;
      if (
        projectedBytes > MAX_WORKSPACE_CONTENT_SEARCH_FILE_BYTES
        || bytesVisited + projectedBytes > MAX_WORKSPACE_CONTENT_SEARCH_BYTES
      ) {
        skippedCount += 1;
        incomplete = true;
        continue;
      }
      bytesVisited += projectedBytes;
      const content = await readSearchableContent(
        access,
        context.workspaceId,
        workspace.canonicalCwd,
        entry,
        signal
      );
      if (content === undefined) {
        skippedCount += 1;
        incomplete = true;
        continue;
      }
      if (projectContentMatches(
        entry,
        content,
        query,
        needle,
        Boolean(payload.caseSensitive),
        matches
      )) incomplete = true;
    }
  }

  const truncated = matches.length >= MAX_WORKSPACE_CONTENT_SEARCH_RESULTS
    || filesVisited >= MAX_WORKSPACE_CONTENT_SEARCH_FILES
    || bytesVisited >= MAX_WORKSPACE_CONTENT_SEARCH_BYTES
    || directories.length > 0;
  return {
    workspaceId: context.workspaceId,
    query,
    matches,
    filesVisited,
    bytesVisited,
    skippedCount,
    truncated,
    incomplete: incomplete || truncated
  };
}

async function readSearchableContent(
  access: WorkspaceFileAccess,
  workspaceId: string,
  canonicalCwd: string,
  entry: WorkspaceFileEntry,
  signal?: AbortSignal
): Promise<string | undefined> {
  const resolved = await access.resolveContainedPath(canonicalCwd, entry.relativePath, "file");
  const initialRevision = access.revision(workspaceId, entry.relativePath, resolved.stats);
  if (
    initialRevision !== entry.revision
    || safeWorkspaceFileByteLength(resolved.stats.size) > MAX_WORKSPACE_CONTENT_SEARCH_FILE_BYTES
  ) return undefined;
  if (signal?.aborted) throw connectionClosedDuringSearch();
  const handle = await open(resolved.path, "r");
  try {
    const buffer = Buffer.alloc(safeWorkspaceFileByteLength(resolved.stats.size) + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const finalStats = await handle.stat();
    if (
      bytesRead > MAX_WORKSPACE_CONTENT_SEARCH_FILE_BYTES
      || access.revision(workspaceId, entry.relativePath, finalStats) !== initialRevision
    ) return undefined;
    const contentBytes = buffer.subarray(0, bytesRead);
    if (contentBytes.includes(0)) return undefined;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    } catch {
      return undefined;
    }
  } finally {
    await handle.close();
  }
}

function projectContentMatches(
  entry: WorkspaceFileEntry,
  content: string,
  query: string,
  needle: string,
  caseSensitive: boolean,
  matches: WorkspaceFileContentSearchMatch[]
): boolean {
  const lines = content.split(/\r?\n/u);
  let truncatedLine = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (matches.length >= MAX_WORKSPACE_CONTENT_SEARCH_RESULTS) return truncatedLine;
    const line = lines[lineIndex] ?? "";
    const boundedLine = line.slice(0, MAX_WORKSPACE_CONTENT_SEARCH_LINE_CHARS);
    if (boundedLine.length < line.length) truncatedLine = true;
    const folded = caseSensitive ? undefined : foldContentSearchText(boundedLine);
    const searchable = folded?.text ?? boundedLine;
    let from = 0;
    while (from <= searchable.length - needle.length) {
      const columnIndex = searchable.indexOf(needle, from);
      if (columnIndex < 0) break;
      const matchStart = folded?.starts[columnIndex] ?? columnIndex;
      const matchEnd = folded?.ends[columnIndex + needle.length - 1] ?? (columnIndex + query.length);
      const snippet = contentSearchSnippet(line, matchStart, Math.max(1, matchEnd - matchStart));
      matches.push({
        entry,
        line: lineIndex + 1,
        column: matchStart + 1,
        snippet: snippet.text,
        snippetTruncated: snippet.truncated
      });
      if (matches.length >= MAX_WORKSPACE_CONTENT_SEARCH_RESULTS) return truncatedLine;
      from = columnIndex + Math.max(1, needle.length);
    }
  }
  return truncatedLine;
}

function foldContentSearchText(value: string): {
  text: string;
  starts: number[];
  ends: number[];
} {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const source = String.fromCodePoint(codePoint);
    const folded = source.toLowerCase();
    const end = index + source.length;
    text += folded;
    for (let foldedIndex = 0; foldedIndex < folded.length; foldedIndex += 1) {
      starts.push(index);
      ends.push(end);
    }
    index = end;
  }
  return { text, starts, ends };
}

function contentSearchSnippet(
  line: string,
  matchStart: number,
  matchLength: number
): { text: string; truncated: boolean } {
  const halfWindow = Math.max(
    0,
    Math.floor((MAX_WORKSPACE_CONTENT_SEARCH_SNIPPET_CHARS - matchLength) / 2)
  );
  const start = Math.max(0, Math.min(matchStart - halfWindow, line.length));
  const end = Math.min(line.length, start + MAX_WORKSPACE_CONTENT_SEARCH_SNIPPET_CHARS);
  return {
    text: line.slice(start, end),
    truncated: start > 0 || end < line.length
  };
}

function connectionClosedDuringSearch(): HostCommandError {
  return new HostCommandError("CONNECTION_CLOSED", "Workspace content search was cancelled.", true);
}
