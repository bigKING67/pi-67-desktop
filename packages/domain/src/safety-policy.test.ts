import { describe, expect, it } from "vitest";
import { classifyShellCommand, decideApproval } from "./safety-policy.js";

describe("classifyShellCommand", () => {
  it("allows narrow read-only commands", () => {
    expect(classifyShellCommand("git status --short")).toBe("workspace-read");
  });

  it("detects destructive and external commands", () => {
    expect(classifyShellCommand("rm -rf build")).toBe("bulk-delete");
    expect(classifyShellCommand("git push origin main")).toBe("git-external-action");
  });
});

describe("decideApproval", () => {
  it("blocks tools in untrusted workspaces", () => {
    expect(
      decideApproval(
        { toolName: "read", category: "workspace-read", target: "." },
        "untrusted",
        "guided"
      )
    ).toEqual({ allow: false, approvalRequired: false, reason: "Workspace is not trusted." });
  });

  it("allows local writes only in balanced mode", () => {
    const intent = { toolName: "write", category: "workspace-write", target: "src/a.ts" } as const;
    expect(decideApproval(intent, "trusted", "guided").approvalRequired).toBe(true);
    expect(decideApproval(intent, "trusted", "balanced").allow).toBe(true);
  });
});
