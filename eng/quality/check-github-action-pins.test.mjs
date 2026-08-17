import { describe, expect, it } from "vitest";
import { mutableActionReferences } from "./check-github-action-pins.mjs";

describe("GitHub Action pin governance", () => {
  it("accepts full external commit SHAs and local reusable workflows", () => {
    const source = `
steps:
  - uses: actions/checkout@${"a".repeat(40)} # v5
jobs:
  reuse:
    uses: ./.github/workflows/reusable.yml
`;
    expect(mutableActionReferences(source)).toEqual([]);
  });

  it("rejects mutable major tags", () => {
    expect(mutableActionReferences("steps:\n  - uses: actions/checkout@v5\n", "ci.yml"))
      .toEqual(["ci.yml:2 must pin an external action to a full lowercase commit SHA: actions/checkout@v5"]);
    expect(mutableActionReferences("steps:\n  - uses : actions/checkout@v5\n", "spaced.yml"))
      .toEqual(["spaced.yml:2 must pin an external action to a full lowercase commit SHA: actions/checkout@v5"]);
  });
});
