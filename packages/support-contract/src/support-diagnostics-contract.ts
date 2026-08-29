export const SUPPORT_DIAGNOSTICS_UPLOAD_ORIGIN = "https://support.52671314.xyz";
export const SUPPORT_DIAGNOSTICS_UPLOAD_PATH = "/v1/diagnostics";
export const SUPPORT_DIAGNOSTICS_UPLOAD_URL = (
  `${SUPPORT_DIAGNOSTICS_UPLOAD_ORIGIN}${SUPPORT_DIAGNOSTICS_UPLOAD_PATH}`
);
export const SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES = 64 * 1024;
export const SUPPORT_DIAGNOSTICS_RETENTION_DAYS = 30;
export const SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA = "pi67-support-submission.v1";
export const SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA = "pi67-support-receipt.v1";
export const SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA = "pi67-support-diagnostics.v5";

const REPORT_ID_PATTERN = /^PI67-[A-F0-9]{12}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_JSON_DEPTH = 12;
const MAX_OBJECT_KEYS = 256;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_LENGTH = 4_096;
const FORBIDDEN_DIAGNOSTIC_KEYS = new Set([
  "accesskey",
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "cwd",
  "environment",
  "password",
  "path",
  "prompt",
  "prompts",
  "rawtoolpayload",
  "rawtoolpayloads",
  "secret",
  "secretaccesskey",
  "sourcebodies",
  "sourcebody",
  "stack",
  "stacktrace",
  "stderr",
  "stdout",
  "toolpayload",
  "toolpayloads"
]);
const DIAGNOSTIC_KEYS = new Set([
  "schema",
  "generatedAt",
  "application",
  "desktop",
  "agentHost",
  "piConfiguration",
  "renderer",
  "runtimeCollection",
  "runtime"
]);
const APPLICATION_KEYS = new Set(["version", "platform", "architecture", "packaged"]);

export interface SupportDiagnosticsDocument extends Record<string, unknown> {
  schema: typeof SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA;
  generatedAt: number;
  application: {
    version: string;
    platform: "darwin" | "linux" | "win32";
    architecture: "arm64" | "x64";
    packaged: boolean;
  };
  desktop: Record<string, unknown>;
  agentHost: Record<string, unknown>;
  piConfiguration: Record<string, unknown>;
  renderer: Record<string, unknown>;
  runtimeCollection: {
    status: "available" | "unavailable";
    failure?: string;
  };
  runtime?: Record<string, unknown>;
}

export interface SupportDiagnosticsSubmission {
  schema: typeof SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA;
  reportId: string;
  createdAt: number;
  diagnosticsSha256: string;
  diagnostics: SupportDiagnosticsDocument;
}

export interface SupportDiagnosticsUploadReceipt {
  schema: typeof SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA;
  reportId: string;
  receivedAt: number;
  sizeBytes: number;
  sha256: string;
}

export function isSupportDiagnosticsDocument(value: unknown): value is SupportDiagnosticsDocument {
  if (!isRecord(value) || !hasOnlyKeys(value, DIAGNOSTIC_KEYS)) return false;
  if (value.schema !== SUPPORT_DIAGNOSTICS_DOCUMENT_SCHEMA || !isTimestamp(value.generatedAt)) return false;
  if (!isApplication(value.application)) return false;
  if (!isRecord(value.desktop) || !isRecord(value.agentHost) || !isRecord(value.piConfiguration)) return false;
  if (!isRecord(value.renderer) || !isRuntimeCollection(value.runtimeCollection)) return false;
  if (value.runtimeCollection.status === "available") {
    if (!isRecord(value.runtime)) return false;
  } else if ("runtime" in value) {
    return false;
  }
  return isBoundedDiagnosticValue(value, 0);
}

export function isSupportDiagnosticsSubmission(value: unknown): value is SupportDiagnosticsSubmission {
  return isRecord(value)
    && hasOnlyKeys(value, new Set(["schema", "reportId", "createdAt", "diagnosticsSha256", "diagnostics"]))
    && value.schema === SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA
    && isReportId(value.reportId)
    && isTimestamp(value.createdAt)
    && isSha256(value.diagnosticsSha256)
    && isSupportDiagnosticsDocument(value.diagnostics);
}

export function isSupportDiagnosticsUploadReceipt(value: unknown): value is SupportDiagnosticsUploadReceipt {
  return isRecord(value)
    && hasOnlyKeys(value, new Set(["schema", "reportId", "receivedAt", "sizeBytes", "sha256"]))
    && value.schema === SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA
    && isReportId(value.reportId)
    && isTimestamp(value.receivedAt)
    && Number.isSafeInteger(value.sizeBytes)
    && Number(value.sizeBytes) > 0
    && Number(value.sizeBytes) <= SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES
    && isSha256(value.sha256);
}

export function isReportId(value: unknown): value is string {
  return typeof value === "string" && REPORT_ID_PATTERN.test(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA_256_PATTERN.test(value);
}

function isApplication(value: unknown): value is SupportDiagnosticsDocument["application"] {
  return isRecord(value)
    && hasOnlyKeys(value, APPLICATION_KEYS)
    && typeof value.version === "string"
    && value.version.length >= 1
    && value.version.length <= 64
    && (value.platform === "darwin" || value.platform === "linux" || value.platform === "win32")
    && (value.architecture === "arm64" || value.architecture === "x64")
    && typeof value.packaged === "boolean"
    && (value.platform !== "linux" || value.packaged === false);
}

function isRuntimeCollection(value: unknown): value is SupportDiagnosticsDocument["runtimeCollection"] {
  if (!isRecord(value)) return false;
  if (value.status === "available") return hasOnlyKeys(value, new Set(["status"]));
  return value.status === "unavailable"
    && hasOnlyKeys(value, new Set(["status", "failure"]))
    && typeof value.failure === "string"
    && value.failure.length >= 1
    && value.failure.length <= 64;
}

function isBoundedDiagnosticValue(value: unknown, depth: number): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value) || Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_STRING_LENGTH;
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_ITEMS
      && value.every((item) => isBoundedDiagnosticValue(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_KEYS) return false;
  return entries.every(([key, item]) => (
    key.length >= 1
    && key.length <= 64
    && !FORBIDDEN_DIAGNOSTIC_KEYS.has(key.toLowerCase())
    && isBoundedDiagnosticValue(item, depth + 1)
  ));
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
