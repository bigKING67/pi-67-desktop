import { strictObject, Type, Value, type Static } from "./typebox-schema.js";

/** Main -> renderer update state carried by the pi67:update-* invoke results and change event. */
export const UPDATE_CHANNEL = "unsigned-preview";
export const MAXIMUM_UPDATE_ARTIFACT_BYTES = 2 * 1_024 * 1_024 * 1_024;

const metadata = {
  channel: Type.Literal(UPDATE_CHANNEL),
  currentVersion: Type.String({ minLength: 1, maxLength: 100 }),
  automaticChecks: Type.Boolean(),
  checkedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
};
const artifact = {
  version: Type.String({ minLength: 1, maxLength: 100 }),
  artifactName: Type.String({ minLength: 1, maxLength: 240 }),
  artifactBytes: Type.Integer({ minimum: 1, maximum: MAXIMUM_UPDATE_ARTIFACT_BYTES })
};

export const DesktopUpdateStateSchema = Type.Union([
  strictObject({
    phase: Type.Union([Type.Literal("checking"), Type.Literal("current"), Type.Literal("idle")]),
    ...metadata
  }),
  strictObject({
    phase: Type.Union([Type.Literal("available"), Type.Literal("installing")]),
    ...metadata,
    ...artifact
  }),
  strictObject({
    phase: Type.Literal("downloading"),
    ...metadata,
    ...artifact,
    transferred: Type.Integer({ minimum: 0, maximum: MAXIMUM_UPDATE_ARTIFACT_BYTES }),
    percent: Type.Number({ minimum: 0, maximum: 100 })
  }),
  strictObject({
    phase: Type.Union([Type.Literal("disabled"), Type.Literal("error")]),
    ...metadata,
    detail: Type.String({ minLength: 1, maxLength: 500 })
  })
]);

export type DesktopUpdateState = Static<typeof DesktopUpdateStateSchema>;

export type DesktopUpdateStateIssue = "metadata" | "artifact" | "progress" | "phase";

/**
 * Validates an untrusted update state, including the cross-field rules a schema cannot express:
 * the artifact name must be the canonical installer for its version and progress cannot exceed it.
 * A valid `checkedAt` is normalized to ISO-8601; an unparseable one is dropped.
 */
export function parseDesktopUpdateState(
  value: unknown
): { ok: true; state: DesktopUpdateState } | { ok: false; issue: DesktopUpdateStateIssue } {
  if (!Value.Check(DesktopUpdateStateSchema, value)) return { ok: false, issue: schemaIssue(value) };
  if ("artifactName" in value && !isCanonicalArtifactName(value.version, value.artifactName)) {
    return { ok: false, issue: "artifact" };
  }
  if (value.phase === "downloading" && value.transferred > value.artifactBytes) {
    return { ok: false, issue: "progress" };
  }
  const { checkedAt, ...rest } = value;
  const normalized = checkedAt === undefined || Number.isNaN(Date.parse(checkedAt))
    ? undefined
    : new Date(checkedAt).toISOString();
  return { ok: true, state: { ...rest, ...(normalized ? { checkedAt: normalized } : {}) } };
}

/**
 * Published artifacts use the current `New-Money` prefix or the legacy `Pi-67-Desktop` prefix, which
 * Main also accepts. Releases stay on the legacy prefix while installed renderers only accept it.
 */
const ARTIFACT_PREFIXES = ["New-Money", "Pi-67-Desktop"] as const;

export function isCanonicalArtifactName(version: string, artifactName: string): boolean {
  return ARTIFACT_PREFIXES.some((prefix) => artifactName === `${prefix}-${version}-win-x64-unsigned-preview.exe`
    || artifactName === `${prefix}-${version}-mac-arm64-unsigned-preview.zip`);
}

function schemaIssue(value: unknown): DesktopUpdateStateIssue {
  if (typeof value !== "object" || value === null) return "metadata";
  const record = value as Record<string, unknown>;
  const withMetadata = { phase: "idle", channel: record.channel, currentVersion: record.currentVersion,
    automaticChecks: record.automaticChecks, ...(record.checkedAt === undefined ? {} : { checkedAt: record.checkedAt }) };
  if (!Value.Check(DesktopUpdateStateSchema, withMetadata)) return "metadata";
  if (record.phase === "downloading" && Value.Check(DesktopUpdateStateSchema, {
    ...withMetadata, phase: "available", version: record.version, artifactName: record.artifactName,
    artifactBytes: record.artifactBytes
  })) return "progress";
  if (["available", "installing", "downloading"].includes(String(record.phase))) return "artifact";
  return "phase";
}
