using Pi67.Desktop.Domain.Compatibility;

namespace Pi67.Desktop.Domain.Tests.Compatibility;

public sealed class SemanticVersionTests
{
    [Theory]
    [InlineData("0.80.6", 0, 80, 6, null)]
    [InlineData("v1.2.3-beta.2+build.7", 1, 2, 3, "beta.2")]
    public void TryParseAcceptsValidVersions(
        string value,
        int major,
        int minor,
        int patch,
        string? preRelease)
    {
        bool parsed = SemanticVersion.TryParse(value, out SemanticVersion version);

        Assert.True(parsed);
        Assert.Equal(major, version.Major);
        Assert.Equal(minor, version.Minor);
        Assert.Equal(patch, version.Patch);
        Assert.Equal(preRelease, version.PreRelease);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1.2")]
    [InlineData("1.2.3-")]
    [InlineData("1.2.3+")]
    [InlineData("1.2.3-01")]
    [InlineData("01.2.3")]
    [InlineData("1.2.3-alpha_beta")]
    public void TryParseRejectsInvalidVersions(string value) =>
        Assert.False(SemanticVersion.TryParse(value, out _));

    [Fact]
    public void CompareToUsesSemVerPreReleasePrecedence()
    {
        SemanticVersion beta2 = SemanticVersion.Parse("1.0.0-beta.2");
        SemanticVersion beta10 = SemanticVersion.Parse("1.0.0-beta.10");
        SemanticVersion release = SemanticVersion.Parse("1.0.0");

        Assert.True(beta2 < beta10);
        Assert.True(beta10 < release);
        Assert.True(release >= SemanticVersion.Parse("1.0.0+another-build"));
    }
}
