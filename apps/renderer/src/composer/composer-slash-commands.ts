import type { SlashCommandDescriptor } from "@pi67/protocol";
import {
  isPiTuiBuiltinName,
  type PiDesktopActionDescriptor
} from "../pi-actions/pi-desktop-actions.js";

const MAX_VISIBLE_SLASH_COMMANDS = 60;

export type ComposerSlashItem = PiDesktopActionDescriptor | SlashCommandDescriptor;

export interface ComposerSlashCatalog {
  items: readonly ComposerSlashItem[];
  total: number;
  truncated: boolean;
}

export interface SlashQuery {
  leadingWhitespace: string;
  token: string;
}

export interface SlashInvocation {
  name: string;
  arguments: string;
}

export type ComposerSlashSubmissionRoute =
  | { kind: "desktop-action"; action: PiDesktopActionDescriptor; arguments: string }
  | { kind: "extension"; command: string }
  | { kind: "unsupported-pi-builtin"; name: string }
  | { kind: "prompt" };

export function slashQueryFromDraft(text: string): SlashQuery | undefined {
  const match = /^(\s*)\/([^\s]*)$/u.exec(text);
  if (!match) return undefined;
  return { leadingWhitespace: match[1] ?? "", token: match[2] ?? "" };
}

export function slashInvocationFromDraft(text: string): SlashInvocation | undefined {
  const match = /^\s*\/([^\s]+)(?:\s+([\s\S]*))?\s*$/u.exec(text);
  const name = match?.[1];
  if (!name) return undefined;
  return { name: normalize(name), arguments: match?.[2]?.trim() ?? "" };
}

export function filterSlashCommands(
  catalog: ComposerSlashCatalog,
  query: SlashQuery
): ComposerSlashItem[] {
  const needle = normalize(query.token);
  return catalog.items
    .map((command) => ({ command, score: commandScore(command, needle) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => (
      sourceOrder(left.command.source) - sourceOrder(right.command.source)
      || left.score - right.score
      || left.command.name.localeCompare(right.command.name)
    ))
    .slice(0, MAX_VISIBLE_SLASH_COMMANDS)
    .map((entry) => entry.command);
}

export function insertSlashCommand(text: string, command: ComposerSlashItem): string {
  const query = slashQueryFromDraft(text);
  return query ? `${query.leadingWhitespace}/${command.name} ` : text;
}

export function exactSlashCommand(
  text: string,
  catalog: ComposerSlashCatalog
): ComposerSlashItem | undefined {
  const invocation = slashInvocationFromDraft(text);
  return invocation
    ? catalog.items.find((command) => normalize(command.name) === invocation.name)
    : undefined;
}

export function resolveSlashSubmission(
  text: string,
  catalog: ComposerSlashCatalog
): ComposerSlashSubmissionRoute {
  const invocation = slashInvocationFromDraft(text);
  if (!invocation) return { kind: "prompt" };
  const command = exactSlashCommand(text, catalog);
  if (command?.source === "desktop-action") {
    return { kind: "desktop-action", action: command, arguments: invocation.arguments };
  }
  if (command?.source === "extension") {
    return { kind: "extension", command: text.trim().replace(/^\//u, "") };
  }
  if (!command && isPiTuiBuiltinName(invocation.name)) {
    return { kind: "unsupported-pi-builtin", name: invocation.name };
  }
  return { kind: "prompt" };
}

export function isSlashInvocation(text: string): boolean {
  return /^\s*\/[^\s]+/u.test(text);
}

function commandScore(command: ComposerSlashItem, needle: string): number {
  if (!needle) return 0;
  const name = normalize(command.name);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 10;
  if (name.includes(needle)) return 20;
  if (normalize(command.description ?? "").includes(needle)) return 30;
  return -1;
}

function sourceOrder(source: ComposerSlashItem["source"]): number {
  if (source === "desktop-action") return 0;
  if (source === "extension") return 1;
  if (source === "prompt") return 2;
  return 3;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
