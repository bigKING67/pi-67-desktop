import { describe, expect, it } from "vitest";
import {
  classifyShellCommand,
  decideApproval,
  isHardStopRiskCategory
} from "./safety-policy.js";

describe("AUTO safety policy", () => {
  it("admits routine local Git and project script operations", () => {
    for (const command of [
      "git add src/a.ts",
      "git commit -m fixture",
      "git switch feature/policy",
      "git fetch origin",
      "git pull --ff-only",
      "git clone https://fixture.invalid/repo.git vendor/repo",
      "pnpm run dev",
      "npm run format",
      "yarn codegen"
    ]) expect(classifyShellCommand(command), command).toBe("workspace-command");
  });

  it("keeps hard-stop risks behind approval and identifies their shared contract", () => {
    for (const category of [
      "bulk-delete",
      "destructive-shell",
      "persistent-state-delete",
      "external-delete"
    ] as const) {
      expect(isHardStopRiskCategory(category)).toBe(true);
      expect(decideApproval({
        toolName: "configured-tool",
        category,
        target: "configured-tool"
      }, "trusted", "balanced")).toMatchObject({
        allow: false,
        approvalRequired: true
      });
    }
    for (const category of ["external-submit", "credential-or-auth", "system-configuration"] as const) {
      expect(isHardStopRiskCategory(category)).toBe(false);
    }
  });

  it("recognizes destructive Git variants before the ordinary local Git grant", () => {
    for (const command of [
      "git checkout -f feature/policy",
      "git checkout --force feature/policy",
      "git switch --force feature/policy",
      "git switch --discard-changes feature/policy",
      "git branch --delete old-branch",
      "git tag -d old-tag",
      "git stash drop",
      "git worktree prune",
      "git submodule deinit vendor/fixture",
      "git push -f origin main",
      "git push --force-with-lease origin main",
      "git push -d origin old-branch",
      "git push origin --delete old-branch",
      "git push origin :old-branch"
    ]) expect(classifyShellCommand(command), command).toBe("destructive-shell");
  });

  it("separates project dependency changes from user and toolchain installs", () => {
    for (const command of [
      "yarn global add fixture",
      "uv tool install fixture",
      "cargo install fixture",
      "cargo uninstall fixture",
      "dotnet tool uninstall fixture"
    ]) expect(classifyShellCommand(command), command).toBe("system-configuration");
    expect(classifyShellCommand("dotnet add package fixture")).toBe("dependency-change");
  });

  it("retains hard-stop deletion when Shell control flow is not otherwise classifiable", () => {
    expect(classifyShellCommand("if true; then rm -rf build; fi")).toBe("bulk-delete");
    expect(classifyShellCommand("if true; then rm file.txt; fi")).toBe("destructive-shell");
    expect(classifyShellCommand("if true; then sudo chmod 600 file.txt; fi")).toBe("ambiguous-command");
  });
});
