using Pi67.Desktop.Domain.Compatibility;

namespace Pi67.Desktop.Application.Bootstrap;

public enum BootstrapStepStatus
{
    Pending,
    AwaitingConfirmation,
    Running,
    Succeeded,
    Skipped,
    Failed,
    Cancelled,
}

public sealed record ComponentInventory(
    string Id,
    string DisplayName,
    bool IsInstalled,
    string? InstalledVersion,
    string TestedVersion,
    RuntimeCompatibilityStatus Compatibility,
    string Detail);

public sealed record BootstrapInventory(
    string OperatingSystem,
    string Architecture,
    Version OperatingSystemVersion,
    IReadOnlyList<ComponentInventory> Components,
    string AgentDirectory,
    bool AgentDirectoryExists,
    bool AgentDirectoryIsGit,
    bool AgentDirectoryIsDirty);

public sealed record BootstrapStep(
    string Id,
    string DisplayName,
    string Description,
    string Source,
    string? ExactCommand,
    bool RequiresElevation,
    BootstrapStepStatus Status,
    string? FailureCode,
    string? FailureMessage);

public interface IBootstrapCoordinator
{
    Task<BootstrapInventory> InventoryAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<BootstrapStep>> PlanAsync(
        BootstrapInventory inventory,
        CancellationToken cancellationToken);

    IAsyncEnumerable<BootstrapStep> ExecuteStepAsync(
        string stepId,
        bool confirmed,
        CancellationToken cancellationToken);

    Task CancelAsync(CancellationToken cancellationToken);
}
