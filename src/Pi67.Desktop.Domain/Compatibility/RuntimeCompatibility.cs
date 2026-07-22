namespace Pi67.Desktop.Domain.Compatibility;

public enum RuntimeCompatibilityStatus
{
    Supported,
    Unverified,
    TooOld,
    Incompatible,
    Unavailable,
}

public sealed record RuntimeCompatibility(
    RuntimeCompatibilityStatus Status,
    SemanticVersion? InstalledVersion,
    SemanticVersion TestedVersion,
    SemanticVersion MinimumVersion,
    string Reason)
{
    public bool CanRunRpc => Status is RuntimeCompatibilityStatus.Supported
        or RuntimeCompatibilityStatus.Unverified;

    public static RuntimeCompatibility Evaluate(
        SemanticVersion? installed,
        SemanticVersion tested,
        SemanticVersion minimum)
    {
        if (installed is null)
        {
            return new(
                RuntimeCompatibilityStatus.Unavailable,
                null,
                tested,
                minimum,
                "Pi runtime was not found.");
        }

        if (installed.Value.CompareTo(minimum) < 0)
        {
            return new(
                RuntimeCompatibilityStatus.TooOld,
                installed,
                tested,
                minimum,
                $"Pi {installed} is older than the minimum RPC version {minimum}.");
        }

        if (installed.Value.CompareTo(tested) == 0)
        {
            return new(
                RuntimeCompatibilityStatus.Supported,
                installed,
                tested,
                minimum,
                $"Pi {installed} matches the tested runtime.");
        }

        return new(
            RuntimeCompatibilityStatus.Unverified,
            installed,
            tested,
            minimum,
            $"Pi {installed} supports the minimum RPC contract but is not the tested version {tested}.");
    }
}
