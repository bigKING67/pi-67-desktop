using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Domain.Security;
using Pi67.Desktop.Infrastructure.Windows.Runtime;

namespace Pi67.Desktop.Infrastructure.Windows.Tests.Runtime;

public sealed class WindowsPiRuntimeLocatorTests
{
    [Fact]
    public async Task BuildLaunchPlanUsesRealPiRpcAndDesktopOnlyExtension()
    {
        string workspace = Path.GetTempPath();
        SemanticVersion version = SemanticVersion.Parse("0.80.6");
        PiRuntimeDescriptor runtime = new(
            "C:\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js",
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\npm\\node_modules\\@earendil-works\\pi-coding-agent",
            "C:\\Users\\test\\.pi\\agent",
            version.ToString(),
            RuntimeCompatibility.Evaluate(version, version, version),
            PiRuntimeLauncherKind.NodePackageEntry,
            "test");
        WindowsPiRuntimeLocator locator = new(new PiRuntimeLocatorOptions(version, version, runtime.AgentDirectory));
        PiSessionLaunchOptions options = new(
            workspace,
            SessionPath: null,
            SessionName: "Native test",
            PersistSession: true,
            Offline: true,
            ExtensionPaths: [Path.Combine(workspace, "pi67-desktop-safety.mjs")],
            ProjectTrustDecision.TrustOnce);

        PiRuntimeLaunchPlan plan = await locator.BuildLaunchPlanAsync(
            runtime,
            options,
            TestContext.Current.CancellationToken);

        Assert.Equal(runtime.NodeExecutable, plan.FileName);
        Assert.Contains("rpc", plan.Arguments);
        Assert.Contains("--approve", plan.Arguments);
        Assert.Contains("--offline", plan.Arguments);
        Assert.Contains("--extension", plan.Arguments);
        Assert.Equal("1", plan.Environment["PI67_DESKTOP"]);
        Assert.Equal("0", plan.Environment["PI_TELEMETRY"]);
    }

    [Fact]
    public async Task BuildLaunchPlanDeniesProjectResourcesByDefault()
    {
        SemanticVersion version = SemanticVersion.Parse("0.80.6");
        PiRuntimeDescriptor runtime = new(
            "pi.cmd",
            null,
            null,
            "C:\\Users\\test\\.pi\\agent",
            version.ToString(),
            RuntimeCompatibility.Evaluate(version, version, version),
            PiRuntimeLauncherKind.CommandShim,
            "test");
        WindowsPiRuntimeLocator locator = new(new PiRuntimeLocatorOptions(version, version, runtime.AgentDirectory));

        PiRuntimeLaunchPlan plan = await locator.BuildLaunchPlanAsync(
            runtime,
            new PiSessionLaunchOptions(Path.GetTempPath(), null, null, true, false, []),
            TestContext.Current.CancellationToken);

        Assert.Contains("--no-approve", plan.Arguments);
    }
}
