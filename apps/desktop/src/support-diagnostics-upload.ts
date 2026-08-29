import { createHash, randomBytes } from "node:crypto";
import {
  SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES,
  SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
  SUPPORT_DIAGNOSTICS_UPLOAD_URL,
  isSupportDiagnosticsSubmission,
  isSupportDiagnosticsUploadReceipt,
  type SupportDiagnosticsDocument,
  type SupportDiagnosticsUploadReceipt
} from "@pi67/support-contract";

const SUPPORT_DIAGNOSTICS_UPLOAD_TIMEOUT_MS = 15_000;
const MAX_RECEIPT_RESPONSE_BYTES = 8 * 1024;

type SupportDiagnosticsFetcher = (
  input: string,
  init: RequestInit
) => Promise<Response>;

export async function uploadSupportDiagnostics(options: {
  diagnostics: SupportDiagnosticsDocument;
  serializedDiagnostics: string;
  applicationVersion: string;
  fetcher: SupportDiagnosticsFetcher;
  now?: () => number;
  reportId?: string;
  signal?: AbortSignal;
}): Promise<SupportDiagnosticsUploadReceipt> {
  const reportId = options.reportId ?? createReportId();
  const createdAt = (options.now ?? Date.now)();
  const diagnosticsSha256 = sha256(options.serializedDiagnostics);
  const submission = {
    schema: SUPPORT_DIAGNOSTICS_SUBMISSION_SCHEMA,
    reportId,
    createdAt,
    diagnosticsSha256,
    diagnostics: options.diagnostics
  };
  if (!isSupportDiagnosticsSubmission(submission)) {
    throw new Error("The support diagnostics submission is invalid.");
  }
  const body = JSON.stringify(submission);
  const sizeBytes = Buffer.byteLength(body, "utf8");
  if (sizeBytes > SUPPORT_DIAGNOSTICS_MAX_SUBMISSION_BYTES) {
    throw new Error("脱敏诊断超过上传大小限制，请改用本地导出。");
  }

  const response = await requestUpload(options.fetcher, body, options.applicationVersion, options.signal);
  if (response.url.length > 0 && response.url !== SUPPORT_DIAGNOSTICS_UPLOAD_URL) {
    throw new Error("诊断上传服务返回了非预期地址，请改用本地导出。");
  }
  if (!response.ok || (response.status !== 200 && response.status !== 201)) {
    throw uploadResponseError(response.status);
  }
  const receipt = parseReceipt(await readBoundedResponseText(response));
  if (
    receipt.reportId !== reportId
    || receipt.sha256 !== diagnosticsSha256
    || receipt.sizeBytes !== sizeBytes
  ) {
    throw new Error("诊断上传回执与本次提交不一致，请改用本地导出。");
  }
  return receipt;
}

function createReportId(): string {
  return `PI67-${randomBytes(6).toString("hex").toUpperCase()}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function requestUpload(
  fetcher: SupportDiagnosticsFetcher,
  body: string,
  applicationVersion: string,
  signal?: AbortSignal
): Promise<Response> {
  try {
    return await fetcher(SUPPORT_DIAGNOSTICS_UPLOAD_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "User-Agent": `Pi-67-Desktop/${applicationVersion}`
      },
      body,
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(SUPPORT_DIAGNOSTICS_UPLOAD_TIMEOUT_MS)
    });
  } catch (error) {
    if (isAbortError(error)) throw new Error("诊断上传超时，请检查网络后重试或导出到本地。");
    throw new Error("诊断上传服务暂时不可用，请稍后重试或导出到本地。");
  }
}

function uploadResponseError(status: number): Error {
  if (status === 413) return new Error("脱敏诊断超过上传大小限制，请改用本地导出。");
  if (status === 429) return new Error("诊断上传过于频繁，请稍后再试。");
  return new Error(`诊断上传服务暂时不可用（HTTP ${status}），请稍后重试或导出到本地。`);
}

function parseReceipt(value: string): SupportDiagnosticsUploadReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("诊断上传服务返回了无效回执，请改用本地导出。");
  }
  if (!isSupportDiagnosticsUploadReceipt(parsed)) {
    throw new Error("诊断上传服务返回了无效回执，请改用本地导出。");
  }
  return parsed;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_RECEIPT_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("诊断上传服务返回了过大的回执，请改用本地导出。");
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output + decoder.decode();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
