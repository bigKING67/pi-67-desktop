import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PromptAttachmentAccess, PromptAttachmentReadRequest } from "./prompt-attachment.js";

export const DESKTOP_ATTACHMENT_EXTENSION_PATH = "<inline:pi67-desktop-attachments>";
export const DESKTOP_ATTACHMENT_TOOL_NAME = "read_attachment";

export function createDesktopPromptAttachmentExtension(access: PromptAttachmentAccess): InlineExtension {
  return {
    name: "pi67-desktop-attachments",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: DESKTOP_ATTACHMENT_TOOL_NAME,
        label: "读取附件",
        description: "Inspect files explicitly attached to the current Desktop prompt by opaque attachment id.",
        promptSnippet: "Read a Desktop prompt attachment without guessing a filesystem path",
        promptGuidelines: [
          "Use read_attachment for ordinary prompt attachments before relying on their contents.",
          "Start with list or metadata, then use bounded read_text, search, archive, strings, or byte operations."
        ],
        executionMode: "parallel",
        parameters: Type.Object({
          setId: Type.String({ minLength: 1, maxLength: 128 }),
          operation: Type.Union([
            Type.Literal("list"),
            Type.Literal("metadata"),
            Type.Literal("read_text"),
            Type.Literal("search"),
            Type.Literal("strings"),
            Type.Literal("read_bytes"),
            Type.Literal("list_archive"),
            Type.Literal("read_archive_entry")
          ]),
          attachmentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          query: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 * 1024 * 1024 })),
          length: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 * 1024 })),
          entry: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 }))
        }, { additionalProperties: false }),
        async execute(_toolCallId, params, signal) {
          const result = await access.read(params as PromptAttachmentReadRequest, signal);
          return {
            content: [{ type: "text", text: result.text }],
            details: result.details
          };
        }
      });
    }
  };
}

export function isVerifiedDesktopAttachmentTool(
  pi: ExtensionAPI,
  toolName: string,
  input: unknown
): boolean {
  if (toolName !== DESKTOP_ATTACHMENT_TOOL_NAME || !isAttachmentReadContract(input)) return false;
  try {
    const matches = pi.getAllTools().filter((tool) => tool.name === toolName);
    const source = matches.length === 1 ? matches[0]?.sourceInfo : undefined;
    return source?.source === "inline"
      && source.path === DESKTOP_ATTACHMENT_EXTENSION_PATH
      && source.scope === "temporary"
      && source.origin === "top-level";
  } catch {
    return false;
  }
}

function isAttachmentReadContract(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => ![
    "setId",
    "operation",
    "attachmentId",
    "query",
    "offset",
    "length",
    "entry"
  ].includes(key))) return false;
  if (!isOpaqueId(record.setId)) return false;
  const operation = record.operation;
  if (![
    "list",
    "metadata",
    "read_text",
    "search",
    "strings",
    "read_bytes",
    "list_archive",
    "read_archive_entry"
  ].includes(String(operation))) return false;
  if (operation !== "list" && !isOpaqueId(record.attachmentId)) return false;
  if (record.attachmentId !== undefined && !isOpaqueId(record.attachmentId)) return false;
  if (operation === "search" && !isBoundedString(record.query, 2_000)) return false;
  if (record.query !== undefined && !isBoundedString(record.query, 2_000)) return false;
  if (record.offset !== undefined && !isBoundedInteger(record.offset, 0, 100 * 1024 * 1024)) return false;
  if (record.length !== undefined && !isBoundedInteger(record.length, 1, 32 * 1024)) return false;
  if (operation === "read_archive_entry" && !isBoundedString(record.entry, 4_096)) return false;
  return record.entry === undefined || isBoundedString(record.entry, 4_096);
}

function isOpaqueId(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function isBoundedString(value: unknown, maximum: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
