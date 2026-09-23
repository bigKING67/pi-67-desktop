import { Compile } from "typebox/compile";
import { createEventEnvelopeValidator } from "./envelope.js";
import { PiProviderConfigurationChangedSchema } from "./provider-configuration-schemas.js";
import { Value } from "./typebox-schema.js";

// Separate entry: the Renderer retains interpreted validation and strict CSP.
// Only this application-owned schema is compiled; no payload or user schema is cached.
let providerCheck: ReturnType<typeof Compile<typeof PiProviderConfigurationChangedSchema>> | undefined;

export const isHostEventEnvelope = createEventEnvelopeValidator((schema, value) => {
  if (schema !== PiProviderConfigurationChangedSchema) return Value.Check(schema, value);
  providerCheck ??= Compile(PiProviderConfigurationChangedSchema);
  return providerCheck.Check(value);
});
