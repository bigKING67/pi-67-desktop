import { describe, expect, it } from "vitest";
import { validatePiRuntimeContract } from "./pi-runtime-contract.mjs";

const packageNames = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent"
];

describe("Pi runtime release contract", () => {
  it("requires the native MCP patch for Pi 1.0.0", () => {
    expect(() => validatePiRuntimeContract(packageFixture("1.0.0"), workspaceFixture("1.0.0")))
      .toThrow(/native MCP host\/lifecycle patch/u);
    const workspace = `${workspaceFixture("1.0.0")}patchedDependencies:\n  '@earendil-works/pi-coding-agent@1.0.0': patches/@earendil-works__pi-coding-agent@1.0.0.patch\n`;
    expect(validatePiRuntimeContract(packageFixture("1.0.0"), workspace).runtimeVersion).toBe("1.0.0");
    expect(() => validatePiRuntimeContract(packageFixture("1.0.0"), workspace.replace("  '@earendil-works/pi-coding-agent@1.0.0'", "  # '@earendil-works/pi-coding-agent@1.0.0'")))
      .toThrow(/native MCP host\/lifecycle patch/u);
  });
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

  it.each([undefined, "^9.8.7", "9.8.6"])("rejects a missing or drifted transitive Pi TUI pin: %s", (version) => {
    const workspace = workspaceFixture("9.8.7").replace("  '@earendil-works/pi-tui': 9.8.7\n",
      version === undefined ? "" : `  '@earendil-works/pi-tui': ${version}\n`);
    expect(() => validatePiRuntimeContract(packageFixture("9.8.7"), workspace))
      .toThrow(/overrides\.@earendil-works\/pi-tui must/u);
  });
});

function packageFixture(version) {
  return {
    dependencies: Object.fromEntries(packageNames.map((name) => [name, version]))
  };
}

function workspaceFixture(version) {
  return `packages:\n  - packages/*\noverrides:\n${[...packageNames, "@earendil-works/pi-tui"].map((name) => `  '${name}': ${version}`).join("\n")}\nallowBuilds:\n`;
}
