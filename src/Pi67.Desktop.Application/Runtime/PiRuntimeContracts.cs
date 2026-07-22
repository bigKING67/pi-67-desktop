using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Domain.Security;

namespace Pi67.Desktop.Application.Runtime;

public enum PiRuntimeLauncherKind
{
    NodePackageEntry,
    NativeExecutable,
    CommandShim,
}

public sealed record PiRuntimeDescriptor(
    string Executable,
    string? NodeExecutable,
    string? PackageRoot,
    string AgentDirectory,
    string? RawVersion,
    RuntimeCompatibility Compatibility,
    PiRuntimeLauncherKind LauncherKind,
    string Source);

public sealed record PiRuntimeLaunchPlan(
    string FileName,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    IReadOnlyDictionary<string, string?> Environment,
    PiRuntimeDescriptor Runtime);

public sealed record PiSessionLaunchOptions(
    string WorkspacePath,
    string? SessionPath,
    string? SessionName,
    bool PersistSession,
    bool Offline,
    IReadOnlyList<string> ExtensionPaths,
    ProjectTrustDecision ProjectTrustDecision = ProjectTrustDecision.Deny);

public interface IPiRuntimeLocator
{
    Task<PiRuntimeDescriptor> LocateAsync(CancellationToken cancellationToken);

    Task<PiRuntimeDescriptor> ValidateAsync(
        PiRuntimeDescriptor runtime,
        CancellationToken cancellationToken);

    Task<PiRuntimeLaunchPlan> BuildLaunchPlanAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        CancellationToken cancellationToken);
}
