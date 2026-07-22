using NetArchTest.Rules;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Infrastructure.Windows.Runtime;
using Pi67.Desktop.PiRpc.Transport;
using Pi67.Desktop.Presentation;

namespace Pi67.Desktop.Architecture.Tests;

public sealed class LayerDependencyTests
{
    [Fact]
    public void DomainDoesNotDependOnOuterLayers() => AssertNoDependencies(
        typeof(SemanticVersion).Assembly,
        "Pi67.Desktop.Application",
        "Pi67.Desktop.PiRpc",
        "Pi67.Desktop.Infrastructure.Windows",
        "Pi67.Desktop.Presentation");

    [Fact]
    public void ApplicationDoesNotDependOnImplementations() => AssertNoDependencies(
        typeof(IPiRuntimeLocator).Assembly,
        "Pi67.Desktop.PiRpc",
        "Pi67.Desktop.Infrastructure.Windows",
        "Pi67.Desktop.Presentation");

    [Fact]
    public void PiRpcDoesNotDependOnWindowsOrPresentation() => AssertNoDependencies(
        typeof(PiRpcTransport).Assembly,
        "Pi67.Desktop.Infrastructure.Windows",
        "Pi67.Desktop.Presentation");

    [Fact]
    public void PresentationDoesNotDependOnRuntimeImplementations() => AssertNoDependencies(
        typeof(PresentationAssemblyMarker).Assembly,
        "Pi67.Desktop.PiRpc",
        "Pi67.Desktop.Infrastructure.Windows");

    [Fact]
    public void InfrastructureIsAWindowsOnlyOuterLayer() =>
        Assert.Equal("Pi67.Desktop.Infrastructure.Windows", typeof(WindowsPiRuntimeLocator).Assembly.GetName().Name);

    private static void AssertNoDependencies(System.Reflection.Assembly assembly, params string[] forbidden)
    {
        NetArchTest.Rules.TestResult result = Types.InAssembly(assembly)
            .ShouldNot()
            .HaveDependencyOnAny(forbidden)
            .GetResult();

        Assert.True(result.IsSuccessful, string.Join(", ", result.FailingTypeNames ?? []));
    }
}
