import {
  SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES,
  SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
  SUPPORT_DIAGNOSTICS_RETENTION_DAYS,
  SUPPORT_DIAGNOSTICS_UPLOAD_ORIGIN,
  SUPPORT_DIAGNOSTICS_UPLOAD_PATH,
  isSupportDiagnosticsSubmission,
  isSupportDiagnosticsUploadReceipt,
  type SupportDiagnosticsSubmission,
  type SupportDiagnosticsUploadReceipt
} from "@pi67/support-contract";

const MAX_SUBMISSION_CLOCK_SKEW_MS = 10 * 60_000;

interface R2ObjectMetadata {
  key: string;
  customMetadata?: Record<string, string>;
}

interface SupportDiagnosticsBucket {
  head(this: void, key: string): Promise<R2ObjectMetadata | null>;
  put(
    this: void,
    key: string,
    value: string,
    options: {
      onlyIf: Headers;
      httpMetadata: { contentType: string; cacheControl: string };
      customMetadata: Record<string, string>;
    }
  ): Promise<R2ObjectMetadata | null>;
}

interface SupportDiagnosticsAdmissionId {}

interface SupportDiagnosticsAdmissionStub {
  fetch(this: void, request: Request): Promise<Response>;
}

interface SupportDiagnosticsAdmissionNamespace {
  idFromName(this: void, name: string): SupportDiagnosticsAdmissionId;
  get(this: void, id: SupportDiagnosticsAdmissionId): SupportDiagnosticsAdmissionStub;
}

interface SupportDiagnosticsAdmissionTransaction {
  get<T>(this: void, key: string): Promise<T | undefined>;
  put<T>(this: void, key: string, value: T): Promise<void>;
}

interface SupportDiagnosticsAdmissionState {
  storage: {
    transaction<T>(
      this: void,
      closure: (transaction: SupportDiagnosticsAdmissionTransaction) => Promise<T>
    ): Promise<T>;
  };
}

export interface SupportIngestEnvironment {
  SUPPORT_DIAGNOSTICS_BUCKET: SupportDiagnosticsBucket;
  SUPPORT_DIAGNOSTICS_ADMISSION: SupportDiagnosticsAdmissionNamespace;
}

export interface SupportIngestExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(
    request: Request,
    environment: SupportIngestEnvironment,
    _context: SupportIngestExecutionContext
  ): Promise<Response> {
    return handleSupportDiagnosticsRequest(request, environment);
  }
};

export class SupportDiagnosticsAdmission {
  readonly #state: SupportDiagnosticsAdmissionState;

  constructor(state: SupportDiagnosticsAdmissionState) {
    this.#state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/admit") {
      return new Response(null, { status: 404 });
    }
    const minute = await request.text();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(minute)) {
      return new Response(null, { status: 400 });
    }
    const admitted = await this.#state.storage.transaction(async (transaction) => {
      if (await transaction.get<string>("admittedMinute") === minute) return false;
      await transaction.put("admittedMinute", minute);
      return true;
    });
    return new Response(null, { status: admitted ? 204 : 429 });
  }
}

export async function handleSupportDiagnosticsRequest(
  request: Request,
  environment: SupportIngestEnvironment,
  now = Date.now()
): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== SUPPORT_DIAGNOSTICS_UPLOAD_ORIGIN || url.pathname !== SUPPORT_DIAGNOSTICS_UPLOAD_PATH) {
    return errorResponse(404, "NOT_FOUND");
  }
  if (request.method !== "POST") return errorResponse(405, "METHOD_NOT_ALLOWED", { Allow: "POST" });
  if (request.headers.get("content-type") !== "application/json") {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength === "invalid" || contentLength > SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES) {
    return errorResponse(413, "SUBMISSION_TOO_LARGE");
  }
  const body = await readBoundedRequestText(request);
  if (body === undefined) return errorResponse(413, "SUBMISSION_TOO_LARGE");
  const submission = parseSubmission(body);
  if (!submission) return errorResponse(400, "INVALID_SUBMISSION");
  if (Math.abs(submission.createdAt - now) > MAX_SUBMISSION_CLOCK_SKEW_MS) {
    return errorResponse(400, "SUBMISSION_TIME_OUT_OF_RANGE");
  }
  const computedSha256 = await sha256(`${JSON.stringify(submission.diagnostics, null, 2)}\n`);
  if (computedSha256 !== submission.diagnosticsSha256) {
    return errorResponse(400, "DIAGNOSTICS_CHECKSUM_MISMATCH");
  }

  const key = objectKey(submission);
  const existing = await environment.SUPPORT_DIAGNOSTICS_BUCKET.head(key);
  if (existing) return duplicateResponse(existing, submission, body);

  const admission = await requestAdmission(environment.SUPPORT_DIAGNOSTICS_ADMISSION, now);
  if (admission === "unavailable") {
    return errorResponse(503, "ADMISSION_UNAVAILABLE", { "Retry-After": "60" });
  }
  if (admission === "limited") return errorResponse(429, "RATE_LIMITED", { "Retry-After": "60" });

  const receivedAt = now;
  const metadata = receiptMetadata(submission, body, receivedAt);
  const stored = await environment.SUPPORT_DIAGNOSTICS_BUCKET.put(key, body, {
    onlyIf: onlyIfMissing(),
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    customMetadata: metadata
  });
  if (!stored) {
    const raced = await environment.SUPPORT_DIAGNOSTICS_BUCKET.head(key);
    return raced
      ? duplicateResponse(raced, submission, body)
      : errorResponse(409, "REPORT_ID_COLLISION");
  }
  return receiptResponse(submission, body, receivedAt, 201);
}

async function requestAdmission(
  namespace: SupportDiagnosticsAdmissionNamespace,
  now: number
): Promise<"admitted" | "limited" | "unavailable"> {
  try {
    const id = namespace.idFromName("support-diagnostics-global");
    const stub = namespace.get(id);
    const minute = new Date(now).toISOString().slice(0, 16);
    const response = await stub.fetch(new Request("https://support-admission.invalid/admit", {
      method: "POST",
      body: minute
    }));
    if (response.status === 204) return "admitted";
    if (response.status === 429) return "limited";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function onlyIfMissing(): Headers {
  return new Headers({ "If-None-Match": "*" });
}

function duplicateResponse(
  existing: R2ObjectMetadata,
  submission: SupportDiagnosticsSubmission,
  body: string
): Response {
  const metadata = existing.customMetadata;
  if (
    !metadata
    || metadata.sha256 !== submission.diagnosticsSha256
    || metadata.sizeBytes !== String(utf8ByteLength(body))
    || metadata.reportId !== submission.reportId
  ) {
    return errorResponse(409, "REPORT_ID_COLLISION");
  }
  const receivedAt = Number(metadata.receivedAt);
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
    return errorResponse(500, "INVALID_STORED_RECEIPT");
  }
  return receiptResponse(submission, body, receivedAt, 200);
}

function receiptResponse(
  submission: SupportDiagnosticsSubmission,
  body: string,
  receivedAt: number,
  status: 200 | 201
): Response {
  const receipt: SupportDiagnosticsUploadReceipt = {
    schema: SUPPORT_DIAGNOSTICS_RECEIPT_SCHEMA,
    reportId: submission.reportId,
    receivedAt,
    sizeBytes: utf8ByteLength(body),
    sha256: submission.diagnosticsSha256
  };
  if (!isSupportDiagnosticsUploadReceipt(receipt)) return errorResponse(500, "INVALID_RECEIPT");
  return jsonResponse(receipt, status);
}

function receiptMetadata(
  submission: SupportDiagnosticsSubmission,
  body: string,
  receivedAt: number
): Record<string, string> {
  return {
    reportId: submission.reportId,
    receivedAt: String(receivedAt),
    retentionDays: String(SUPPORT_DIAGNOSTICS_RETENTION_DAYS),
    sha256: submission.diagnosticsSha256,
    sizeBytes: String(utf8ByteLength(body))
  };
}

function objectKey(submission: SupportDiagnosticsSubmission): string {
  const date = new Date(submission.createdAt).toISOString().slice(0, 10).replaceAll("-", "/");
  return `diagnostics/${date}/${submission.reportId}.json`;
}

function parseSubmission(body: string): SupportDiagnosticsSubmission | undefined {
  try {
    const value = JSON.parse(body) as unknown;
    return isSupportDiagnosticsSubmission(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBoundedRequestText(request: Request): Promise<string | undefined> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES) {
      await reader.cancel();
      return undefined;
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output + decoder.decode();
}

function parseContentLength(value: string | null): number | "invalid" {
  if (value === null) return 0;
  if (!/^\d+$/u.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : "invalid";
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function errorResponse(status: number, code: string, headers: HeadersInit = {}): Response {
  return jsonResponse({ code }, status, headers);
}

function jsonResponse(value: unknown, status: number, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders
  });
}
