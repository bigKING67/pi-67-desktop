import { defineConfig } from "tsdown";

export default defineConfig({
  clean: false,
  deps: {
    alwaysBundle: [
      "@pi67/domain",
      "@pi67/protocol/prompt-attachment-limits",
      "@pi67/protocol/prompt-stash-images",
      "@pi67/protocol/repository-environment-action-result-validation",
      "@pi67/protocol/repository-environment-snapshot-validation",
      "@pi67/protocol/worktree-creation-result-validation"
    ]
  },
  dts: false,
  format: "cjs"
});
