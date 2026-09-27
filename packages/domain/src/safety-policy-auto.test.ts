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
      "git push origin :old-branch",
      "git push --mirror origin",
      "git checkout .",
      "git checkout HEAD src/a.ts",
      "git checkout src/a.ts",
      "git restore --staged --worktree .",
      "git restore -S -W .",
      "git reflog expire --expire=now --all",
      "git gc --prune=now"
    ]) expect(classifyShellCommand(command), command).toBe("destructive-shell");
  });

  it("sees destructive Git and deletion behind global options and command prefixes", () => {
    for (const command of [
      "git -C . reset --hard",
      "git --no-pager clean -fdx",
      "git -c core.pager=cat clean -fdx",
      "git --git-dir .git --work-tree . checkout -- .",
      "git -C . push --force origin main",
      "env git reset --hard",
      "env -i CI=1 git clean -fdx",
      "rsync -a --delete src/ dst/"
    ]) expect(classifyShellCommand(command), command).toBe("destructive-shell");
    expect(classifyShellCommand("rd /s /q build")).toBe("bulk-delete");
  });

  it("keeps branch switching and index-only restore outside the destructive set", () => {
    for (const command of [
      "git checkout main",
      "git checkout -b feature-policy",
      "git checkout -b feature/policy origin/main",
      "git restore --staged src/a.ts"
    ]) expect(classifyShellCommand(command), command).toBe("workspace-command");
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
