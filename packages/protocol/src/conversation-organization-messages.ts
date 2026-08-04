export type SessionNameMutation =
  | { action: "set"; name: string }
  | { action: "clear" };

export interface SessionCatalogMutationResult {
  revision: number;
}

export interface ConversationOrganizationCommandPayloads {
  "session.nameByPath": { path: string; mutation: SessionNameMutation };
  "conversation.pin": { path: string; pinned: boolean };
  "conversation.archive": { path: string; archived: boolean };
}

export interface ConversationOrganizationCommandResults {
  "session.nameByPath": SessionCatalogMutationResult;
  "conversation.pin": SessionCatalogMutationResult;
  "conversation.archive": SessionCatalogMutationResult;
}
