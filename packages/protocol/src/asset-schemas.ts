import { Type, type TProperties } from "typebox";
import {
  MAX_ASSET_ID_CHARS,
  MAX_ASSET_READ_BYTES,
  MAX_RUNTIME_ASSET_BYTES
} from "@pi67/domain";
import { ALLOWED_IMAGE_MIME_TYPES } from "./agent-messages.js";

const ImageMimeTypeSchema = Type.Union([
  Type.Literal("image/png"),
  Type.Literal("image/jpeg"),
  Type.Literal("image/webp"),
  Type.Literal("image/gif")
]);

export const AssetReferenceSchema = assetObject({
  id: Type.String({ minLength: 1, maxLength: MAX_ASSET_ID_CHARS }),
  byteLength: Type.Integer({ minimum: 1, maximum: MAX_RUNTIME_ASSET_BYTES }),
  sessionGeneration: Type.Integer({ minimum: 0 })
});

export const AssetReadPayloadSchema = assetObject({
  assetId: Type.String({ minLength: 1, maxLength: MAX_ASSET_ID_CHARS }),
  sessionGeneration: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0, maximum: MAX_RUNTIME_ASSET_BYTES - 1 }),
  length: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_ASSET_READ_BYTES }))
});

export const AssetReadResultSchema = assetObject({
  assetId: Type.String({ minLength: 1, maxLength: MAX_ASSET_ID_CHARS }),
  mimeType: ImageMimeTypeSchema,
  byteLength: Type.Integer({ minimum: 1, maximum: MAX_RUNTIME_ASSET_BYTES }),
  offset: Type.Integer({ minimum: 0, maximum: MAX_RUNTIME_ASSET_BYTES - 1 }),
  // ArrayBuffer shape and range consistency require a realm-aware predicate.
  data: Type.Any(),
  done: Type.Boolean()
});

export function isValidAssetReadResult(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (
    typeof result.assetId !== "string"
    || result.assetId.length < 1
    || result.assetId.length > MAX_ASSET_ID_CHARS
    || !ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === result.mimeType)
    || !Number.isSafeInteger(result.byteLength)
    || Number(result.byteLength) < 1
    || Number(result.byteLength) > MAX_RUNTIME_ASSET_BYTES
    || !Number.isSafeInteger(result.offset)
    || Number(result.offset) < 0
    || !(result.data instanceof ArrayBuffer)
    || result.data.byteLength < 1
    || result.data.byteLength > MAX_ASSET_READ_BYTES
    || typeof result.done !== "boolean"
  ) return false;
  const end = Number(result.offset) + result.data.byteLength;
  return end <= Number(result.byteLength) && result.done === (end === Number(result.byteLength));
}

function assetObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
