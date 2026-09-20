import { createPublicKey, type KeyObject } from "node:crypto";

/** Source-owned trust anchor. Never load a verification key from the runtime bundle. */
export function openVikingRuntimeTrustedKey(): KeyObject {
  return createPublicKey(`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHZBTs2xkGv5LqhuXn1CuVjzO+inzXydazwSMF8K/iS0=
-----END PUBLIC KEY-----`);
}
