import { createHash } from "node:crypto";
import {
  extractPartsFromPayload,
  extractTextFromPayload,
  sanitizeCapturedText,
  shouldCaptureText,
  truncateCaptureText,
} from "../shared/capture-utils.mjs";

function normalizeRole(role) {
  const value = String(role || "").toLowerCase();
  if (value === "user") return "user";
  if (value === "assistant") return "assistant";
  if (value === "tool" || value === "tool_result") return "user";
  if (value === "tool_call" || value === "toolcall") return "assistant";
  return "";
}

function entryPayload(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type === "message" && entry.message && typeof entry.message === "object") return entry.message;
  if (entry.message && typeof entry.message === "object") return entry.message;
  return entry;
}

function faithfulDecision(rawText, cfg) {
  const sanitized = sanitizeCapturedText(rawText);
  if (!sanitized) return { shouldCapture: false, reason: "empty", text: "" };
  const capped = truncateCaptureText(sanitized, cfg.captureMaxLength || 24000);
  const compact = String(capped || "").replace(/\s+/g, " ").trim();
  if (/^\[openviking-memory\]/i.test(compact)) return { shouldCapture: false, reason: "plugin_status", text: "" };
  if (/^\/[a-z0-9_-]{1,64}\b/i.test(compact)) return { shouldCapture: false, reason: "slash_command", text: "" };
  return { shouldCapture: true, reason: "faithful", text: capped };
}

export function extractBranchCapturePayloads(branch, syncedCaptureCount = 0, cfg = {}, expectedPrefixHash = "") {
  const entries = Array.isArray(branch) ? branch : [];
  const captures = captureEntries(entries, cfg);
  const previousCount = Math.max(0, Math.floor(Number(syncedCaptureCount) || 0));
  const actualPrefixHash = hashSourceIds(captures.slice(0, previousCount).map((entry) => entry.sourceId));
  const resetWatermark = captures.length < previousCount
    || Boolean(expectedPrefixHash && expectedPrefixHash !== actualPrefixHash);
  const start = resetWatermark ? 0 : Math.min(previousCount, captures.length);
  return {
    payloads: captures.slice(start).map((entry) => entry.payload),
    prefixHashes: captures.slice(start).map((_entry, index) => (
      hashSourceIds(captures.slice(0, start + index + 1).map((capture) => capture.sourceId))
    )),
    nextEntryCount: captures.length,
    observedEntryCount: entries.length,
    observedCaptureCount: captures.length,
    currentPrefixHash: hashSourceIds(captures.map((entry) => entry.sourceId)),
    resetWatermark,
  };
}

function captureEntries(entries, cfg) {
  const captures = [];
  let turnNumber = 0;
  for (const entry of entries) {
    const payload = entryPayload(entry);
    if (!payload) continue;
    const role = normalizeRole(payload.role || payload.type || payload.kind);
    if (!role) continue;
    if (role === "user") turnNumber++;
    if (role === "assistant" && cfg.captureAssistantTurns === false) continue;

    const parts = extractPartsFromPayload(payload, { toolMaxChars: cfg.captureToolMaxChars });
    const rawText = cfg.captureToolResults === false
      ? parts.filter((part) => part?.type === "text").map((part) => part.text || "").join("\n\n")
      : extractTextFromPayload(payload, { toolMaxChars: cfg.captureToolMaxChars });
    const decision = cfg.faithfulCapture || cfg.takeoverEnabled
      ? faithfulDecision(rawText, cfg)
      : shouldCaptureText(rawText, role, cfg);
    const structuredParts = cfg.captureToolResults === false ? [] : parts.filter((part) => part?.type !== "text");
    if (!decision.shouldCapture && structuredParts.length === 0) continue;

    const hasTextPart = parts.some((part) => part?.type === "text");
    const bodyParts = [
      ...(hasTextPart && decision.shouldCapture && decision.text ? [{ type: "text", text: decision.text }] : []),
      ...structuredParts,
    ];
    const body = bodyParts.length > 0 ? { role, parts: bodyParts } : { role, content: decision.text };
    if (cfg.peerId) body.peer_id = cfg.peerId;
    const sourceId = stableSourceId(entry, body, captures.length);
    body.source_message_ids = [sourceId];
    body.turn_id = `pi-turn-${Math.max(1, turnNumber)}`;
    body.message_kind = role === "user" ? "user_query" : "assistant_step";
    captures.push({ sourceId, payload: body });
  }
  return captures;
}

function stableSourceId(entry, payload, captureIndex) {
  const identity = {
    captureIndex,
    entryId: String(entry?.id ?? entry?.entryId ?? ""),
    parentId: String(entry?.parentId ?? entry?.parent_id ?? ""),
    payload,
  };
  return `pi67:${createHash("sha256").update(stableStringify(identity)).digest("hex")}`;
}

function hashSourceIds(ids) {
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
