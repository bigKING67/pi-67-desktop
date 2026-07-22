namespace Pi67.Desktop.Domain.Sessions;

public sealed record PiSessionReference
{
    public PiSessionReference(
        string desktopThreadId,
        string workspacePath,
        string sessionPath,
        string? piSessionId,
        string? displayName,
        DateTimeOffset lastOpenedAt)
    {
        DesktopThreadId = RequireValue(desktopThreadId, nameof(desktopThreadId));
        WorkspacePath = RequireValue(workspacePath, nameof(workspacePath));
        SessionPath = RequireValue(sessionPath, nameof(sessionPath));
        PiSessionId = string.IsNullOrWhiteSpace(piSessionId) ? null : piSessionId.Trim();
        DisplayName = string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim();
        LastOpenedAt = lastOpenedAt;
    }

    public string DesktopThreadId { get; }

    public string WorkspacePath { get; }

    public string SessionPath { get; }

    public string? PiSessionId { get; }

    public string? DisplayName { get; }

    public DateTimeOffset LastOpenedAt { get; }

    private static string RequireValue(string value, string parameterName) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new ArgumentException("Value cannot be empty.", parameterName)
            : value.Trim();
}
