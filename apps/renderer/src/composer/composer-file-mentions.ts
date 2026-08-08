import {
  MAX_COMPOSER_WORKSPACE_FILE_REFS,
  type ComposerWorkspaceFileRef,
  type WorkspaceFileEntry
} from "@pi67/domain";

export interface ComposerFileMentionQuery {
  query: string;
  start: number;
  end: number;
}

export function composerFileMentionQuery(
  text: string,
  cursor = text.length
): ComposerFileMentionQuery | undefined {
  const boundedCursor = Math.max(0, Math.min(text.length, cursor));
  const prefix = text.slice(0, boundedCursor);
  const match = /(?:^|[\s(])@([^\s@[\]]*)$/u.exec(prefix);
  if (!match) return undefined;
  const query = match[1] ?? "";
  return {
    query,
    start: boundedCursor - query.length - 1,
    end: boundedCursor
  };
}

export function insertComposerFileMention(
  text: string,
  query: ComposerFileMentionQuery,
  entry: WorkspaceFileEntry
): { text: string; cursor: number; reference: ComposerWorkspaceFileRef } {
  const token = composerFileMentionToken(entry.relativePath);
  const suffix = text.slice(query.end);
  const separator = suffix.length === 0 || /^\s/u.test(suffix) ? " " : "";
  const nextText = `${text.slice(0, query.start)}${token}${separator}${suffix}`;
  return {
    text: nextText,
    cursor: query.start + token.length + separator.length,
    reference: {
      id: entry.id,
      revision: entry.revision,
      relativePath: entry.relativePath
    }
  };
}

export function insertComposerFileMentionAtCursor(
  text: string,
  cursor: number,
  reference: ComposerWorkspaceFileRef
): { text: string; cursor: number } {
  const boundedCursor = Math.max(0, Math.min(text.length, cursor));
  const before = text.slice(0, boundedCursor);
  const after = text.slice(boundedCursor);
  const token = composerFileMentionToken(reference.relativePath);
  const prefix = before.length > 0 && !/\s$/u.test(before) ? " " : "";
  const suffix = after.length === 0 || !/^\s/u.test(after) ? " " : "";
  return {
    text: `${before}${prefix}${token}${suffix}${after}`,
    cursor: before.length + prefix.length + token.length + suffix.length
  };
}

export function mergeComposerFileReference(
  current: readonly ComposerWorkspaceFileRef[],
  reference: ComposerWorkspaceFileRef
): ComposerWorkspaceFileRef[] {
  const withoutSameIdentity = current.filter((item) => item.id !== reference.id);
  return [...withoutSameIdentity, reference].slice(-MAX_COMPOSER_WORKSPACE_FILE_REFS);
}

export function referencesPresentInComposerText(
  text: string,
  references: readonly ComposerWorkspaceFileRef[]
): ComposerWorkspaceFileRef[] {
  return references.filter((reference) => text.includes(composerFileMentionToken(reference.relativePath)));
}

function composerFileMentionToken(relativePath: string): string {
  return `@[${relativePath}]`;
}

export function removeComposerFileReference(
  text: string,
  cursor: number,
  reference: ComposerWorkspaceFileRef
): { text: string; cursor: number } {
  const token = composerFileMentionToken(reference.relativePath);
  let nextText = text;
  let nextCursor = Math.max(0, Math.min(text.length, cursor));
  let offset = 0;
  while ((offset = nextText.indexOf(token, offset)) >= 0) {
    let start = offset;
    let end = offset + token.length;
    const before = nextText[start - 1];
    const after = nextText[end];
    if (isHorizontalSpace(before) && isHorizontalSpace(after)) end += 1;
    else if ((start === 0 || before === "\n") && isHorizontalSpace(after)) end += 1;
    else if (isHorizontalSpace(before) && (end === nextText.length || after === "\n")) start -= 1;
    nextCursor = cursorAfterRemoval(nextCursor, start, end);
    nextText = `${nextText.slice(0, start)}${nextText.slice(end)}`;
    offset = start;
  }
  return { text: nextText, cursor: Math.min(nextCursor, nextText.length) };
}

function isHorizontalSpace(value: string | undefined): boolean {
  return value === " " || value === "\t";
}

function cursorAfterRemoval(cursor: number, start: number, end: number): number {
  if (cursor <= start) return cursor;
  if (cursor >= end) return cursor - (end - start);
  return start;
}

export function composerFileMentionOptionId(index: number): string {
  return `composer-file-mention-${index}`;
}
