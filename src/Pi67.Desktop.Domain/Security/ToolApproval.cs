namespace Pi67.Desktop.Domain.Security;

public enum ToolRiskCategory
{
    WorkspaceRead,
    WorkspaceWrite,
    ExternalPath,
    DestructiveShell,
    SystemConfiguration,
    DependencyChange,
    GitExternalAction,
    DownloadAndExecute,
    BulkDelete,
    AmbiguousCompoundCommand,
}

public enum ToolApprovalDecision
{
    AllowAutomatically,
    AllowOnce,
    Deny,
}

public sealed record ToolApprovalRequest(
    string ToolCallId,
    string ToolName,
    ToolRiskCategory RiskCategory,
    string Summary,
    string? CanonicalPath,
    bool IsWorkspaceContained);
