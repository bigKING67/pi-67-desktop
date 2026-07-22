namespace Pi67.Desktop.Domain.Security;

public enum ProjectTrustDecision
{
    TrustOnce,
    TrustAndPersist,
    Deny,
}

public enum ProjectTrustState
{
    Unknown,
    TrustedForProcess,
    TrustedPersistently,
    Denied,
}

public sealed record ProjectTrustStatus(
    string WorkspacePath,
    ProjectTrustState State,
    bool Persisted,
    IReadOnlyList<string> TrustRequiringResources,
    string Reason);
