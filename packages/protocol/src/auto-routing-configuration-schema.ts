import { strictObject } from "./typebox-schema.js";
import {
  PiDefaultModelSelectionSchema,
  type PiDefaultModelSelection
} from "./pi-model-selection-schema.js";

/** The three physical Pi models used by the Desktop-owned Auto virtual model. */
export interface PiAutoRoutingSelection {
  judge: PiDefaultModelSelection;
  standard: PiDefaultModelSelection;
  complex: PiDefaultModelSelection;
}

export const PiAutoRoutingSelectionSchema = strictObject({
  judge: PiDefaultModelSelectionSchema,
  standard: PiDefaultModelSelectionSchema,
  complex: PiDefaultModelSelectionSchema
});
