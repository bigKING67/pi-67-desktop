import { createHash } from "node:crypto";
import { decodeKnowledgeCanonicalContent, type SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import type { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";

type Read = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-read" }>;
type Scope = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-receipt-open" }>["scope"];
const unavailable = () => new Error("Shared knowledge body unavailable.");

/** Internal exact-version receipt read, not a Pi/Renderer route or model grant.
 * Product consumers must separately bind selection to the current team Session. */
export async function runSharedKnowledgeRead(options: {
  receipts: Pick<SharedKnowledgeReceiptClient, "request" | "signal">;
  scope: Scope; snapshot: Read["snapshot"] | "current"; assetId: string; contentRevision: string;
  signal: AbortSignal; assertCurrent(this: void): void;
}) {
  const { receipts, assetId, contentRevision, assertCurrent } = options;
  const scope = { ...options.scope }, snapshot = options.snapshot === "current" ? "current" : { ...options.snapshot };
  const signal = AbortSignal.any([options.signal, receipts.signal]);
  const check = () => { signal.throwIfAborted(); assertCurrent(); };
  let handleId: string | undefined, closing: Promise<boolean> | undefined;
  const close = () => {
    if (!handleId) return Promise.resolve(false);
    return closing ??= receipts.request({ type: "shared-knowledge-receipt-close", handleId })
      .then(result => result.ok && result.type === "shared-knowledge-receipt-close-result", () => false);
  };
  const cancel = () => { void close(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    check();
    const opened = await receipts.request({ type: "shared-knowledge-receipt-open", scope }, signal);
    if (!opened.ok || opened.type !== "shared-knowledge-receipt-open-result") throw unavailable();
    handleId = opened.handleId; check();
    const result = await receipts.request(snapshot === "current"
      ? { type: "shared-knowledge-index-read-current", handleId, assetId, contentRevision }
      : { type: "shared-knowledge-index-read", handleId, snapshot, assetId, contentRevision }, signal);
    if (!result.ok || !(result.type === "shared-knowledge-index-read-result" || result.type === "shared-knowledge-index-read-current-result")
        || result.type !== (snapshot === "current" ? "shared-knowledge-index-read-current-result" : "shared-knowledge-index-read-result")
        || result.assetId !== assetId || result.contentRevision !== contentRevision
        || snapshot !== "current" && (result.snapshot.epoch !== snapshot.epoch || result.snapshot.cursor !== snapshot.cursor)) throw unavailable();
    const content = decodeKnowledgeCanonicalContent(result.canonicalContent, contentRevision,
      text => createHash("sha256").update(text, "utf8").digest("hex"));
    check();
    if (!await close()) throw unavailable();
    check(); return { snapshot: { ...result.snapshot }, assetId, contentRevision, content };
  } catch { throw unavailable(); }
  finally { signal.removeEventListener("abort", cancel); await close(); }
}
