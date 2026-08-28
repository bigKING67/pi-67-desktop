const DEFERRED_NESTED_ASSET = /(?:^|\/)(?:ArchivedConversationsDialog|ChangesPanel|ConversationRenameDialog|MarkdownView|MessagesPanel|PlanProposalCard|RuntimeContextPanel|SubagentsPanel|TrustBanner|WorkspaceFileNameDialog|WorkspaceFileSurface|markdown-url|useFormValidation|useTextField)-/u;
const LAZY_CONVERSATION_BOUNDARY = /(?:^|\/)(?:WorkspaceShell|LiveConversationSurface)-/u;

export function resolveRendererModulePreloadDependencies(
  _filename: string,
  dependencies: string[],
  context: { hostType: "html" | "js" }
): string[] {
  if (context.hostType !== "js" || !LAZY_CONVERSATION_BOUNDARY.test(_filename)) return dependencies;
  return dependencies.filter((dependency) => !DEFERRED_NESTED_ASSET.test(dependency));
}
