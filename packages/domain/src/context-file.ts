export const MAX_CONTEXT_FILE_BYTES = 1_000_000;

export type ContextFileCategory =
  | "managed-rule"
  | "rules-context"
  | "system-prompt"
  | "append-system-prompt";

export type ContextFileScope = "managed" | "global" | "project" | "inherited";

export interface ContextFileSummary {
  id: string;
  name: string;
  path: string;
  category: ContextFileCategory;
  scope: ContextFileScope;
  origin: "desktop" | "user" | "workspace" | "ancestor";
  presence: "present" | "missing";
  access: "read-only" | "editable" | "creatable";
  runtimeState: "active" | "overridden" | "not-loaded" | "unavailable";
  detail?: string;
}

export interface ContextFileCatalogResult {
  items: ContextFileSummary[];
  workspaceTrusted: boolean;
}

export interface ContextFileReadResult {
  item: ContextFileSummary;
  content: string;
  revision: string;
}

export interface ContextFileSaveResult {
  item: ContextFileSummary;
  revision: string;
  files: ContextFileCatalogResult;
}
