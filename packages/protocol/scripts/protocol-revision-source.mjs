const protocolRevisionSourcePattern =
  /^export const PROTOCOL_REVISION = "([0-9a-f]{64})" as const;\r?\n$/u;

export function parseProtocolRevisionSource(source) {
  const match = protocolRevisionSourcePattern.exec(source);
  if (!match) {
    throw new Error("Refusing to replace an unexpected protocol-revision.ts shape.");
  }
  return match[1];
}
