import type {
  SlashCommandCatalogResult,
  SlashCommandDescriptor
} from "@pi67/protocol";

const MAX_VISIBLE_SLASH_COMMANDS = 60;

export interface SlashQuery {
  leadingWhitespace: string;
  token: string;
}

export function slashQueryFromDraft(text: string): SlashQuery | undefined {
  const match = /^(\s*)\/([^\s]*)$/u.exec(text);
  if (!match) return undefined;
  return { leadingWhitespace: match[1] ?? "", token: match[2] ?? "" };
}

export function filterSlashCommands(
  catalog: SlashCommandCatalogResult,
  query: SlashQuery
): SlashCommandDescriptor[] {
  const needle = normalize(query.token);
  return catalog.items
    .map((command) => ({ command, score: commandScore(command, needle) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => left.score - right.score || left.command.name.localeCompare(right.command.name))
    .slice(0, MAX_VISIBLE_SLASH_COMMANDS)
    .map((entry) => entry.command);
}

export function insertSlashCommand(text: string, command: SlashCommandDescriptor): string {
  const query = slashQueryFromDraft(text);
  return query ? `${query.leadingWhitespace}/${command.name} ` : text;
}

export function exactSlashCommand(
  text: string,
  catalog: SlashCommandCatalogResult
): SlashCommandDescriptor | undefined {
  const match = /^\s*\/([^\s]+)(?:\s|$)/u.exec(text);
  const name = match?.[1];
  return name ? catalog.items.find((command) => command.name === name) : undefined;
}

export function isSlashInvocation(text: string): boolean {
  return /^\s*\/[^\s]+/u.test(text);
}

function commandScore(command: SlashCommandDescriptor, needle: string): number {
  if (!needle) return sourceOrder(command.source) * 10;
  const name = normalize(command.name);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 10 + sourceOrder(command.source);
  if (name.includes(needle)) return 20 + sourceOrder(command.source);
  if (normalize(command.description ?? "").includes(needle)) return 30 + sourceOrder(command.source);
  return -1;
}

function sourceOrder(source: SlashCommandDescriptor["source"]): number {
  if (source === "extension") return 0;
  if (source === "prompt") return 1;
  return 2;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
