import type { ComposerDraftRecord } from "@pi67/protocol";

function parseStartupModel(value: unknown): ComposerDraftRecord["startupModel"] | undefined {
  const record = exactPair(value, "provider", "model");
  if (!record || !bounded(record.provider, 512) || !bounded(record.model, 512)) return undefined;
  return { provider: record.provider, model: record.model };
}

type StartupConfiguration = Pick<ComposerDraftRecord,
  "startupModel" | "startupThinkingLevel" | "interactionMode" | "startupConfigurationPending">;

export function parseStartupConfiguration(
  candidate: Record<string, unknown>,
  provisional: boolean
): StartupConfiguration | undefined {
  const pending = candidate.startupConfigurationPending;
  if (pending !== undefined && pending !== true) return undefined;
  const model = parseStartupModel(candidate.startupModel);
  if (candidate.startupModel !== undefined && !model) return undefined;
  const thinking = candidate.startupThinkingLevel;
  if (thinking !== undefined && !bounded(thinking, 64)) return undefined;
  const mode = candidate.interactionMode;
  if (mode !== undefined && mode !== "execute" && mode !== "plan") return undefined;
  if (!provisional && !pending && [model, thinking, mode].some((value) => value !== undefined)) return undefined;
  return {
    ...(pending ? { startupConfigurationPending: pending } : {}),
    ...(model ? { startupModel: model } : {}),
    ...(thinking ? { startupThinkingLevel: thinking } : {}),
    ...(mode ? { interactionMode: mode } : {})
  };
}

export function parseDraftTeamScope(value: unknown): ComposerDraftRecord["teamScope"] | undefined {
  const record = exactPair(value, "teamId", "projectId");
  if (!record || !bounded(record.teamId, 128) || !bounded(record.projectId, 128)
    || /[\s\p{Cc}]/u.test(record.teamId + record.projectId)) return undefined;
  return { teamId: record.teamId, projectId: record.projectId };
}

function exactPair(value: unknown, first: string, second: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && Object.hasOwn(record, first) && Object.hasOwn(record, second) ? record : undefined;
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
}
