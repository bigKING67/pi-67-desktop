import { RuntimeError, isRuntimeError } from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";
import { invalidResponse } from "./enterprise-context-gateway-validation.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ERROR_BODY_BYTES = 16 * 1024;

export interface NewMoneyRequestOptions {
  accessToken?: string;
  readResponse?: (response: Response, signal: AbortSignal) => Promise<unknown>;
  /**
   * Service error codes the caller handles. A matching 4xx response becomes a
   * HostCommandError with `details.serviceError`; other failures keep the generic mapping.
   */
  surfacedErrors?: ReadonlySet<string>;
}

/** One bounded, non-redirecting New Money HTTPS request owned by Agent Host. */
export async function requestNewMoney(
  url: string,
  init: RequestInit,
  options: NewMoneyRequestOptions = {}
): Promise<unknown> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    controller.signal.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.accessToken) headers.set("Authorization", `Bearer ${options.accessToken}`);
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      signal: controller.signal
    });
    if (response.status === 428 && options.readResponse === undefined) {
      void response.body?.cancel().catch(() => undefined);
      return { state: "pending" };
    }
    if (!response.ok) {
      const surfaced = await surfacedServiceError(response, options.surfacedErrors);
      if (surfaced !== undefined) throw surfaced;
      void response.body?.cancel().catch(() => undefined);
      if (response.status >= 500 || response.status === 408 || response.status === 429) {
        throw new RuntimeError("RUNTIME_NOT_READY", `New Money request temporarily failed (${response.status}).`,
          { details: { kind: "enterprise-transport-unavailable" } });
      }
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        response.status === 401
          ? "New Money sign-in expired or was rejected."
          : response.status === 403
            ? "The New Money team does not have permission for this operation."
            : `New Money request failed (${response.status}).`,
        false
      );
    }
    if (options.readResponse !== undefined) return await options.readResponse(response, controller.signal);
    const text = await response.text();
    if (response.status === 204 || text.length === 0) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw invalidResponse("json");
    }
  } catch (error) {
    if (error instanceof HostCommandError || isRuntimeError(error)) throw error;
    throw new RuntimeError(
      "RUNTIME_NOT_READY",
      error instanceof Error && error.name === "AbortError"
        ? "New Money request timed out."
        : "New Money is unavailable.",
      { details: { kind: "enterprise-transport-unavailable" } }
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function surfacedServiceError(
  response: Response,
  surfaced: ReadonlySet<string> | undefined
): Promise<HostCommandError | undefined> {
  if (surfaced === undefined || response.status < 400 || response.status >= 500) return undefined;
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_ERROR_BODY_BYTES) return undefined;
  let code: unknown;
  try {
    const text = await response.text();
    if (text.length > MAX_ERROR_BODY_BYTES) return undefined;
    code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
  } catch {
    return undefined;
  }
  if (typeof code !== "string" || !surfaced.has(code)) return undefined;
  return new HostCommandError(
    "INVALID_PAYLOAD",
    `New Money rejected the request (${code}).`,
    true,
    { serviceError: code, status: response.status }
  );
}
