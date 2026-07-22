using Pi67.Desktop.Domain.Compatibility;

namespace Pi67.Desktop.Domain.Tests.Compatibility;

public sealed class RuntimeCompatibilityTests
{
    private static readonly SemanticVersion Tested = SemanticVersion.Parse("0.80.6");
    private static readonly SemanticVersion Minimum = SemanticVersion.Parse("0.80.0");

    [Fact]
    public void EvaluateReportsExactTestedRuntimeAsSupported()
    {
        RuntimeCompatibility result = RuntimeCompatibility.Evaluate(Tested, Tested, Minimum);

        Assert.Equal(RuntimeCompatibilityStatus.Supported, result.Status);
        Assert.True(result.CanRunRpc);
    }

    [Fact]
    public void EvaluateAllowsNewerRuntimeAsExplicitlyUnverified()
    {
        RuntimeCompatibility result = RuntimeCompatibility.Evaluate(
            SemanticVersion.Parse("0.81.0"),
            Tested,
            Minimum);

        Assert.Equal(RuntimeCompatibilityStatus.Unverified, result.Status);
        Assert.True(result.CanRunRpc);
    }

    [Fact]
    public void EvaluateBlocksMissingAndOldRuntimes()
    {
        Assert.Equal(
            RuntimeCompatibilityStatus.Unavailable,
            RuntimeCompatibility.Evaluate(null, Tested, Minimum).Status);
        Assert.Equal(
            RuntimeCompatibilityStatus.TooOld,
            RuntimeCompatibility.Evaluate(SemanticVersion.Parse("0.79.9"), Tested, Minimum).Status);
    }
}
