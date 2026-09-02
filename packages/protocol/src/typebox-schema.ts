import {
  Any,
  Array,
  Boolean,
  Integer,
  Literal,
  Null,
  Number,
  Object,
  Optional,
  String,
  Union
} from "typebox";
import type { TProperties } from "typebox";
import { Check } from "typebox/value";

// Keep protocol schemas on the small constructor surface they actually use so
// renderer builds do not retain TypeBox's parser and type-evaluation engines.
export const Type = {
  Any,
  Array,
  Boolean,
  Integer,
  Literal,
  Null,
  Number,
  Object,
  Optional,
  String,
  Union
} as const;

export const Value = { Check } as const;

export function strictObject<T extends TProperties>(properties: T) {
  return Object(properties, { additionalProperties: false });
}

export type { Static, TProperties, TSchema } from "typebox";
