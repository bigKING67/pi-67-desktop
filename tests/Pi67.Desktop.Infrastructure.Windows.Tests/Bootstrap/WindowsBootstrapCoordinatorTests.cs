using Pi67.Desktop.Application.Bootstrap;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Infrastructure.Windows.Bootstrap;

namespace Pi67.Desktop.Infrastructure.Windows.Tests.Bootstrap;

public sealed class WindowsBootstrapCoordinatorTests
{
    [Fact]
    public async Task PlanKeepsEverySystemMutationAsASeparateConfirmation()
    {
        WindowsBootstrapCoordinator coordinator = new(new FakeRuntimeLocator(), new FakeCommandRunner());
        BootstrapInventory inventory = CreateInventory(agentExists: false, agentIsGit: false, agentDirty: false);

        IReadOnlyList<BootstrapStep> steps = await coordinator.PlanAsync(
            inventory,
            TestContext.Current.CancellationToken);

        Assert.Equal(["git", "node", "pi", "pi67-manager", "pi67-distro"], steps.Select(static step => step.Id));
        Assert.All(steps, static step => Assert.Equal(BootstrapStepStatus.AwaitingConfirmation, step.Status));
    }

    [Fact]
    public async Task PlanBlocksDistroMutationWhenAgentCheckoutIsDirty()
    {
        WindowsBootstrapCoordinator coordinator = new(new FakeRuntimeLocator(), new FakeCommandRunner());
        BootstrapInventory inventory = CreateInventory(agentExists: true, agentIsGit: true, agentDirty: true);

        IReadOnlyList<BootstrapStep> steps = await coordinator.PlanAsync(
            inventory,
            TestContext.Current.CancellationToken);

        BootstrapStep distro = steps.Single(static step => step.Id == "pi67-distro");
        Assert.Equal(BootstrapStepStatus.Failed, distro.Status);
        Assert.Equal("bootstrap.agent_directory_requires_review", distro.FailureCode);
    }

    [Fact]
    public async Task ExecuteDoesNotRunAnUnconfirmedStep()
    {
        FakeCommandRunner runner = new();
        WindowsBootstrapCoordinator coordinator = new(new FakeRuntimeLocator(), runner);
        List<BootstrapStep> updates = [];

        await foreach (BootstrapStep update in coordinator.ExecuteStepAsync(
            "git",
            confirmed: false,
            cancellationToken: TestContext.Current.CancellationToken))
        {
            updates.Add(update);
        }

        Assert.Equal(BootstrapStepStatus.AwaitingConfirmation, Assert.Single(updates).Status);
        Assert.Equal(0, runner.InvocationCount);
    }

    private static BootstrapInventory CreateInventory(bool agentExists, bool agentIsGit, bool agentDirty)
    {
        string[] ids = ["git", "node", "npm", "pi", "pi67-manager", "pi67-distro"];
        ComponentInventory[] components = ids.Select(static id => new ComponentInventory(
            id,
            id,
            IsInstalled: id == "npm",
            InstalledVersion: id == "npm" ? "11.16.0" : null,
            TestedVersion: "1.0.0",
            id == "npm" ? RuntimeCompatibilityStatus.Supported : RuntimeCompatibilityStatus.Unavailable,
            "test")).ToArray();
        return new BootstrapInventory(
            "Windows",
            "X64",
            new Version(10, 0, 22631),
            components,
            "C:\\Users\\test\\.pi\\agent",
            agentExists,
            agentIsGit,
            agentDirty);
    }

    private sealed class FakeCommandRunner : IWindowsCommandRunner
    {
        public int InvocationCount { get; private set; }

        public Task<WindowsCommandResult> RunAsync(
            string fileName,
            IReadOnlyList<string> arguments,
            string workingDirectory,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            InvocationCount++;
            return Task.FromResult(new WindowsCommandResult(0, string.Empty, string.Empty, false));
        }
    }

    private sealed class FakeRuntimeLocator : IPiRuntimeLocator
    {
        public Task<PiRuntimeDescriptor> LocateAsync(CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<PiRuntimeDescriptor> ValidateAsync(
            PiRuntimeDescriptor runtime,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<PiRuntimeLaunchPlan> BuildLaunchPlanAsync(
            PiRuntimeDescriptor runtime,
            PiSessionLaunchOptions options,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
