import { strictObject, Type } from "./typebox-schema.js";

export const PiConfigurationIdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });

export interface PiDefaultModelSelection {
  provider: string;
  model: string;
}

export const PiDefaultModelSelectionSchema = strictObject({
  provider: PiConfigurationIdentifierSchema,
  model: PiConfigurationIdentifierSchema
});
