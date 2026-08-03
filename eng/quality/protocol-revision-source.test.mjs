import { describe, expect, it } from "vitest";
import { parseProtocolRevisionSource } from "../../packages/protocol/scripts/protocol-revision-source.mjs";

const revision = "a".repeat(64);

describe("protocol revision source", () => {
  it.each(["\n", "\r\n"])("accepts an exact source shape ending in %j", (lineEnding) => {
    expect(
      parseProtocolRevisionSource(
        `export const PROTOCOL_REVISION = "${revision}" as const;${lineEnding}`
      )
    ).toBe(revision);
  });

  it.each([
    `export const PROTOCOL_REVISION = "${revision}" as const;`,
    `export const PROTOCOL_REVISION = "${revision}" as const;\nextra\n`,
    `export let PROTOCOL_REVISION = "${revision}" as const;\n`
  ])("rejects a source outside the exact generated shape", (source) => {
    expect(() => parseProtocolRevisionSource(source)).toThrow(
      "Refusing to replace an unexpected protocol-revision.ts shape."
    );
  });
});
