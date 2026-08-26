import type { NativeSubagentAdmission } from "./native-subagent-admission.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

export interface PiSdkRuntimeOptions {
  workspaceServices?: PiWorkspaceRuntimeServices;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  promptAttachmentAccess?: PromptAttachmentAccess;
  subagentAdmission?: NativeSubagentAdmission;
  subagentParentKey?: string;
}
