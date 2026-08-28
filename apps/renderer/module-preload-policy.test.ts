import { describe, expect, it } from "vitest";
import { resolveRendererModulePreloadDependencies } from "./module-preload-policy.js";

describe("renderer module preload policy", () => {
  const dependencies = [
    "assets/WorkspaceShell-current.js",
    "assets/PlanProposalCard-current.js",
    "assets/MarkdownView-current.js",
    "assets/markdown-url-current.js",
    "assets/TrustBanner-current.js",
    "assets/WorkspaceFileSurface-current.js",
    "assets/WorkspaceFileNameDialog-current.js",
    "assets/ConversationRenameDialog-current.js",
    "assets/ArchivedConversationsDialog-current.js",
    "assets/ChangesPanel-current.js",
    "assets/MessagesPanel-current.js",
    "assets/SubagentsPanel-current.js",
    "assets/RuntimeContextPanel-current.js"
  ];

  it("does not speculate nested optional surfaces for JavaScript dynamic imports", () => {
    expect(resolveRendererModulePreloadDependencies(
      "assets/WorkspaceShell-current.js",
      dependencies,
      { hostType: "js" }
    )).toEqual(["assets/WorkspaceShell-current.js"]);
  });

  it("preserves HTML entry dependencies", () => {
    expect(resolveRendererModulePreloadDependencies(
      "index.html",
      dependencies,
      { hostType: "html" }
    )).toEqual(dependencies);
  });

  it("preserves dependencies after an optional surface is actually requested", () => {
    expect(resolveRendererModulePreloadDependencies(
      "assets/PlanProposalCard-current.js",
      dependencies,
      { hostType: "js" }
    )).toEqual(dependencies);
  });
});
