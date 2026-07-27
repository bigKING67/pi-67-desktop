import { describe, expect, it } from "vitest";
import { validatePiRuntimeContract } from "./pi-runtime-contract.mjs";

const packageNames = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent"
];

describe("Pi runtime release contract", () => {
  it("uses the exact coding-agent dependency as the release runtime", () => {
    const version = "9.8.7-beta.2";
    expect(validatePiRuntimeContract(packageFixture(version), workspaceFixture(version))).toEqual({
      runtimeVersion: version,
      runtimeSpecifier: `@earendil-works/pi-coding-agent@${version}`
    });
  });

  it.each(["^9.8.7", "~9.8.7", ">=9.8.7", "workspace:*", "latest"])(
    "rejects non-exact package dependency %s",
    (version) => {
      expect(() => validatePiRuntimeContract(packageFixture(version), workspaceFixture("9.8.7")))
        .toThrow(/must be an exact version/u);
    }
  );

  it("rejects mismatched Pi package versions", () => {
    const packageJson = packageFixture("9.8.7");
    packageJson.dependencies["@earendil-works/pi-ai"] = "9.8.6";
    expect(() => validatePiRuntimeContract(packageJson, workspaceFixture("9.8.7")))
      .toThrow(/Pi core, AI, and coding-agent package versions must match/u);
  });

  it("rejects missing, non-exact, or mismatched workspace overrides", () => {
    const source = `overrides:\n  '@earendil-works/pi-agent-core': 9.8.7\n  '@earendil-works/pi-ai': ^9.8.7\n`;
    expect(() => validatePiRuntimeContract(packageFixture("9.8.7"), source)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(/overrides\.@earendil-works\/pi-ai must be an exact version[\s\S]*overrides\.@earendil-works\/pi-coding-agent must be an exact version/u)
      })
    );

    expect(() => validatePiRuntimeContract(packageFixture("9.8.7"), workspaceFixture("9.8.6")))
      .toThrow(/must match packages\/pi-runtime\/package\.json \(9\.8\.7\)/u);
  });
});

function packageFixture(version) {
  return {
    dependencies: Object.fromEntries(packageNames.map((name) => [name, version]))
  };
}

function workspaceFixture(version) {
  return `packages:\n  - packages/*\noverrides:\n${packageNames.map((name) => `  '${name}': ${version}`).join("\n")}\nallowBuilds:\n`;
}
