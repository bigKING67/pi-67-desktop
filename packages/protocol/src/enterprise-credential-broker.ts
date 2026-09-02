import { Type, Value, type Static } from "./typebox-schema.js";

const BoundedString = Type.String({ minLength: 1, maxLength: 2_048 });

export const EnterpriseAccessCredentialSchema = Type.Object({
  endpoint: BoundedString,
  accessToken: Type.String({ minLength: 1, maxLength: 16_384 }),
  accountId: BoundedString,
  userId: BoundedString,
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  expiresAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
}, { additionalProperties: false });

export type EnterpriseAccessCredential = Static<typeof EnterpriseAccessCredentialSchema>;

export function isEnterpriseAccessCredential(
  value: unknown
): value is EnterpriseAccessCredential {
  return Value.Check(EnterpriseAccessCredentialSchema, value);
}

export const EnterpriseCredentialBootstrapMessageSchema = Type.Object({
  type: Type.Literal("enterprise-credential-bootstrap"),
  storage: Type.Union([Type.Literal("available"), Type.Literal("unavailable")]),
  credential: Type.Optional(EnterpriseAccessCredentialSchema)
}, { additionalProperties: false });

export type EnterpriseCredentialBootstrapMessage = Static<
  typeof EnterpriseCredentialBootstrapMessageSchema
>;

export const EnterpriseCredentialStoreRequestSchema = Type.Object({
  type: Type.Literal("enterprise-credential-store"),
  requestId: BoundedString,
  credential: EnterpriseAccessCredentialSchema
}, { additionalProperties: false });

export type EnterpriseCredentialStoreRequest = Static<
  typeof EnterpriseCredentialStoreRequestSchema
>;

export const EnterpriseCredentialClearRequestSchema = Type.Object({
  type: Type.Literal("enterprise-credential-clear"),
  requestId: BoundedString
}, { additionalProperties: false });

export type EnterpriseCredentialClearRequest = Static<
  typeof EnterpriseCredentialClearRequestSchema
>;

export const EnterpriseCredentialOperationResultSchema = Type.Object({
  type: Type.Literal("enterprise-credential-operation-result"),
  requestId: BoundedString,
  ok: Type.Boolean(),
  errorCode: Type.Optional(Type.Union([
    Type.Literal("SECURE_STORAGE_UNAVAILABLE"),
    Type.Literal("PERSISTENCE_FAILED")
  ]))
}, { additionalProperties: false });

export type EnterpriseCredentialOperationResult = Static<
  typeof EnterpriseCredentialOperationResultSchema
>;

export function isEnterpriseCredentialBootstrapMessage(
  value: unknown
): value is EnterpriseCredentialBootstrapMessage {
  return Value.Check(EnterpriseCredentialBootstrapMessageSchema, value);
}

export function isEnterpriseCredentialStoreRequest(
  value: unknown
): value is EnterpriseCredentialStoreRequest {
  return Value.Check(EnterpriseCredentialStoreRequestSchema, value);
}

export function isEnterpriseCredentialClearRequest(
  value: unknown
): value is EnterpriseCredentialClearRequest {
  return Value.Check(EnterpriseCredentialClearRequestSchema, value);
}

export function isEnterpriseCredentialOperationResult(
  value: unknown
): value is EnterpriseCredentialOperationResult {
  return Value.Check(EnterpriseCredentialOperationResultSchema, value);
}
