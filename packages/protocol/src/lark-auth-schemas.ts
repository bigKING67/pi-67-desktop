import {
  MAX_LARK_APP_ID_CHARS,
  MAX_LARK_APP_SECRET_CHARS
} from "@pi67/domain";
import { Type } from "./typebox-schema.js";

const LarkAppBrandSchema = Type.Union([Type.Literal("feishu"), Type.Literal("lark")]);

export const LarkAppConfigurationInputSchema = strictObject({
  appId: Type.String({
    minLength: 1,
    maxLength: MAX_LARK_APP_ID_CHARS,
    pattern: "^cli_[A-Za-z0-9]+$"
  }),
  appSecret: Type.String({
    minLength: 1,
    maxLength: MAX_LARK_APP_SECRET_CHARS,
    pattern: "^[^\\s\\u0000-\\u001F\\u007F]+$"
  }),
  brand: LarkAppBrandSchema
});

const LarkAuthTextSchema = (maximum: number) => Type.String({
  minLength: 1,
  maxLength: maximum,
  pattern: "^(?![\\s\\S]*[\\u0000-\\u001F\\u007F])(?=[\\s\\S]*\\S)[\\s\\S]+$"
});

export const LarkAuthSnapshotSchema = strictObject({
  cliStatus: Type.Union([Type.Literal("ready"), Type.Literal("missing")]),
  phase: Type.Union([
    Type.Literal("connected"),
    Type.Literal("disconnected"),
    Type.Literal("authorizing"),
    Type.Literal("error")
  ]),
  verified: Type.Boolean(),
  checkedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  appStatus: Type.Union([
    Type.Literal("ready"),
    Type.Literal("missing"),
    Type.Literal("unknown")
  ]),
  appId: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_LARK_APP_ID_CHARS,
    pattern: "^cli_[A-Za-z0-9]+$"
  })),
  appBrand: Type.Optional(LarkAppBrandSchema),
  appName: Type.Optional(LarkAuthTextSchema(200)),
  userName: Type.Optional(LarkAuthTextSchema(200)),
  tokenStatus: Type.Optional(Type.Union([
    Type.Literal("valid"),
    Type.Literal("needs-refresh"),
    Type.Literal("expired"),
    Type.Literal("invalid"),
    Type.Literal("unknown")
  ])),
  tokenExpiresAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  detail: Type.Optional(LarkAuthTextSchema(500))
});

export const LarkAuthLoginStartResultSchema = strictObject({
  stage: Type.Union([
    Type.Literal("connection-setup"),
    Type.Literal("user-authorization")
  ]),
  status: LarkAuthSnapshotSchema,
  verificationUrl: Type.String({
    minLength: 1,
    maxLength: 2_048,
    pattern: "^https://(?![^/?#]*@)[^\\s/?#]+(?:[/?#][^\\s]*)?$"
  }),
  userCode: Type.Optional(LarkAuthTextSchema(64)),
  authorizationExpiresAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
});

export const LarkCommandResultSchemas = {
  "lark.auth.status": LarkAuthSnapshotSchema,
  "lark.auth.login.begin": LarkAuthLoginStartResultSchema,
  "lark.app.configuration.save": LarkAuthSnapshotSchema
} as const;

function strictObject<T extends Parameters<typeof Type.Object>[0]>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
