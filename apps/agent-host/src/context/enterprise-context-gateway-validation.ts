import type { ExperienceMethodSummary, SharedSopDetail } from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse("object");
  return value as Record<string, unknown>;
}

export function boundedString(value: unknown, field: string, maximum = 2_048): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw invalidResponse(field);
  return value;
}

export function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidResponse(field);
  }
  return value as number;
}

export function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidResponse(field);
  }
  return value;
}

export function boundedOptionalString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw invalidResponse(field);
  return value;
}

export function boundedStringArray(
  value: unknown,
  field: string,
  maximumItems = 64,
  maximumLength = 2_048
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw invalidResponse(field);
  return value.map((item, index) => boundedString(item, `${field}.${index}`, maximumLength));
}

export function optionalExperienceMethod(value: unknown): ExperienceMethodSummary | undefined {
  if (value === undefined || value === null) return undefined;
  const method = asRecord(value);
  return {
    preconditions: boundedStringArray(method.preconditions, "shared.method.preconditions", 40, 500),
    steps: boundedStringArray(method.steps, "shared.method.steps", 80, 1_000),
    tools: boundedStringArray(method.tools, "shared.method.tools", 40, 300),
    validationGates: boundedStringArray(method.validationGates, "shared.method.validationGates", 40, 500),
    completionCriteria: boundedStringArray(method.completionCriteria, "shared.method.completionCriteria", 40, 500),
    failureModes: boundedStringArray(method.failureModes, "shared.method.failureModes", 40, 500),
    rollback: boundedString(method.rollback, "shared.method.rollback", 2_000)
  };
}

export function lowercaseSha256(value: unknown, field: string): string {
  const candidate = boundedString(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(candidate)) throw invalidResponse(field);
  return candidate;
}

export function kebabIdentifier(value: unknown, field: string): string {
  const candidate = boundedString(value, field, 256);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(candidate)) throw invalidResponse(field);
  return candidate;
}

export function optionalTimestamp(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : parseTimestamp(value, field);
}

export function parseEvidence(item: unknown, field: string): SharedSopDetail["evidence"][number] {
  const evidence = asRecord(item);
  const kind = evidence.kind;
  if (kind !== "test" && kind !== "tool-result" && kind !== "user-confirmation" && kind !== "artifact") {
    throw invalidResponse(`${field}.kind`);
  }
  return {
    kind,
    label: boundedString(evidence.label, `${field}.label`, 512),
    reference: `sha256:${lowercaseSha256(evidence.hash, `${field}.hash`)}`,
    verifiedAt: parseTimestamp(evidence.verifiedAt, `${field}.verifiedAt`)
  };
}

export function parseTimestamp(value: unknown, field: string): number {
  if (typeof value !== "string") throw invalidResponse(field);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw invalidResponse(field);
  return timestamp;
}

export function secureUrl(value: unknown, field: string): string {
  const candidate = boundedString(value, field);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw invalidResponse(field);
  }
  if (url.username || url.password || (url.protocol !== "https:" && !isLoopbackHttp(url))) {
    throw invalidResponse(field);
  }
  return candidate;
}

export function invalidResponse(field: string): HostCommandError {
  return new HostCommandError(
    "INVALID_PAYLOAD",
    `Enterprise Context Gateway returned an invalid ${field} field.`,
    false
  );
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
}
