export interface SkillPackProcessWorkerRequest {
  type: "skill-pack-process-request";
  requestId: string;
  executable: string;
  arguments: string[];
  cwd: string;
  environment: Record<string, string>;
  stdinBase64?: string;
}

export type SkillPackProcessWorkerResponse = {
  type: "skill-pack-process-response";
  requestId: string;
  ok: true;
  stdout: string;
  stderr: string;
} | {
  type: "skill-pack-process-response";
  requestId: string;
  ok: false;
  message: string;
};

const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 512 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 512;
const MAX_ENVIRONMENT_VALUE_LENGTH = 32 * 1024;
const MAX_STDIN_BASE64_LENGTH = 2 * 1024 * 1024;

export function isSkillPackProcessWorkerRequest(
  value: unknown
): value is SkillPackProcessWorkerRequest {
  if (!isRecord(value)
    || value.type !== "skill-pack-process-request"
    || !isToken(value.requestId)
    || !isBoundedString(value.executable, 32 * 1024)
    || !isBoundedString(value.cwd, 32 * 1024)
    || !Array.isArray(value.arguments)
    || value.arguments.length > MAX_ARGUMENTS
    || value.arguments.some((argument) => typeof argument !== "string" || argument.includes("\0"))
    || value.arguments.reduce((total, argument) => total + argument.length, 0) > MAX_ARGUMENT_BYTES
    || !isStringRecord(value.environment)
    || (value.stdinBase64 !== undefined
      && (typeof value.stdinBase64 !== "string" || value.stdinBase64.length > MAX_STDIN_BASE64_LENGTH))
  ) return false;
  return true;
}

export function isSkillPackProcessWorkerResponse(
  value: unknown,
  requestId: string
): value is SkillPackProcessWorkerResponse {
  if (!isRecord(value)
    || value.type !== "skill-pack-process-response"
    || value.requestId !== requestId
    || typeof value.ok !== "boolean"
  ) return false;
  return value.ok
    ? typeof value.stdout === "string" && value.stdout.length <= 64 * 1024
      && typeof value.stderr === "string" && value.stderr.length <= 64 * 1024
    : isBoundedString(value.message, 2_048);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_ENVIRONMENT_ENTRIES && entries.every(([key, item]) => (
    key.length > 0
    && key.length <= 256
    && !key.includes("\0")
    && typeof item === "string"
    && item.length <= MAX_ENVIRONMENT_VALUE_LENGTH
    && !item.includes("\0")
  ));
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,100}$/u.test(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.includes("\0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
