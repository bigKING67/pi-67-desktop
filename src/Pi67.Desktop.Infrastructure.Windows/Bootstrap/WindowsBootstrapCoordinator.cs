using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using Pi67.Desktop.Application.Bootstrap;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;

namespace Pi67.Desktop.Infrastructure.Windows.Bootstrap;

public sealed class WindowsBootstrapCoordinator : IBootstrapCoordinator
{
    private const string TestedGitVersion = "2.51.0";
    private const string TestedNodeVersion = "24.18.0";
    private const string TestedNpmVersion = "11.16.0";
    private const string TestedPiVersion = "0.80.6";
    private const string TestedPi67Version = "0.14.3";

    private readonly IPiRuntimeLocator runtimeLocator;
    private readonly IWindowsCommandRunner commandRunner;
    private readonly string agentDirectory;
    private readonly string homeDirectory;
    private CancellationTokenSource? activeStep;

    public WindowsBootstrapCoordinator(
        IPiRuntimeLocator runtimeLocator,
        IWindowsCommandRunner commandRunner,
        string? agentDirectory = null)
    {
        this.runtimeLocator = runtimeLocator ?? throw new ArgumentNullException(nameof(runtimeLocator));
        this.commandRunner = commandRunner ?? throw new ArgumentNullException(nameof(commandRunner));
        homeDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        this.agentDirectory = Path.GetFullPath(agentDirectory ?? Path.Combine(homeDirectory, ".pi", "agent"));
    }

    public async Task<BootstrapInventory> InventoryAsync(CancellationToken cancellationToken)
    {
        Task<ComponentInventory> git = ProbeVersionAsync(
            "git",
            "Git",
            FindExecutable("git.exe") ?? "git.exe",
            ["--version"],
            TestedGitVersion,
            cancellationToken);
        Task<ComponentInventory> node = ProbeVersionAsync(
            "node",
            "Node.js",
            FindExecutable("node.exe") ?? "node.exe",
            ["--version"],
            TestedNodeVersion,
            cancellationToken);
        Task<ComponentInventory> npm = ProbeVersionAsync(
            "npm",
            "npm",
            FindExecutable("npm.cmd") ?? "npm.cmd",
            ["--version"],
            TestedNpmVersion,
            cancellationToken);
        Task<PiRuntimeDescriptor> piRuntime = runtimeLocator.LocateAsync(cancellationToken);
        Task<Pi67Inventory> pi67 = ProbePi67Async(cancellationToken);
        Task<bool> dirty = IsAgentRepositoryDirtyAsync(cancellationToken);

        await Task.WhenAll(git, node, npm, piRuntime, pi67, dirty).ConfigureAwait(false);
        PiRuntimeDescriptor piDescriptor = await piRuntime.ConfigureAwait(false);
        Pi67Inventory pi67Inventory = await pi67.ConfigureAwait(false);
        List<ComponentInventory> components =
        [
            await git.ConfigureAwait(false),
            await node.ConfigureAwait(false),
            await npm.ConfigureAwait(false),
            new ComponentInventory(
                "pi",
                "Upstream Pi",
                piDescriptor.Compatibility.Status is not RuntimeCompatibilityStatus.Unavailable,
                piDescriptor.RawVersion,
                TestedPiVersion,
                piDescriptor.Compatibility.Status,
                piDescriptor.Compatibility.Reason),
            CreatePi67Component("pi67-manager", "pi-67 manager", pi67Inventory.ManagerVersion),
            CreatePi67Component("pi67-distro", "pi-67 distro", pi67Inventory.DistroVersion),
        ];

        bool agentExists = Directory.Exists(agentDirectory);
        bool agentIsGit = Directory.Exists(Path.Combine(agentDirectory, ".git"));
        return new BootstrapInventory(
            RuntimeInformation.OSDescription,
            RuntimeInformation.OSArchitecture.ToString(),
            Environment.OSVersion.Version,
            components,
            agentDirectory,
            agentExists,
            agentIsGit,
            await dirty.ConfigureAwait(false));
    }

    public Task<IReadOnlyList<BootstrapStep>> PlanAsync(
        BootstrapInventory inventory,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(inventory);
        cancellationToken.ThrowIfCancellationRequested();
        List<BootstrapStep> steps = [];
        AddMissingStep(steps, inventory, "git", "Install Git", "Required for pi-67 source and workspace operations.", "Microsoft WinGet / Git for Windows", "winget install --id Git.Git --exact --source winget --silent --disable-interactivity --accept-package-agreements --accept-source-agreements", requiresElevation: false);
        AddMissingStep(steps, inventory, "node", "Install Node.js 24 LTS", "Runs the real installed Pi package and Desktop control bridge.", "Microsoft WinGet / OpenJS", "winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --disable-interactivity --accept-package-agreements --accept-source-agreements", requiresElevation: false);
        AddMissingStep(steps, inventory, "pi", "Install upstream Pi", "Provides the only agent runtime used by Desktop.", "npm registry / @earendil-works", $"npm install -g @earendil-works/pi-coding-agent@{TestedPiVersion}", requiresElevation: false);
        AddMissingStep(steps, inventory, "pi67-manager", "Install pi-67 manager", "Provides supported pi-67 install, doctor, and update workflows.", "npm registry / @bigking67", $"npm install -g @bigking67/pi-67@{TestedPi67Version}", requiresElevation: false);

        ComponentInventory distro = inventory.Components.Single(static item => item.Id == "pi67-distro");
        if (!distro.IsInstalled)
        {
            string? failureCode = inventory.AgentDirectoryExists && (!inventory.AgentDirectoryIsGit || inventory.AgentDirectoryIsDirty)
                ? "bootstrap.agent_directory_requires_review"
                : null;
            steps.Add(new BootstrapStep(
                "pi67-distro",
                "Install pi-67 distro",
                "Creates the managed Pi agent checkout without overwriting existing data.",
                "https://github.com/bigKING67/pi-67",
                "pi-67 --yes install",
                RequiresElevation: false,
                failureCode is null ? BootstrapStepStatus.AwaitingConfirmation : BootstrapStepStatus.Failed,
                failureCode,
                failureCode is null ? null : "The existing agent directory is dirty or is not a Git checkout; review it before installation."));
        }

        return Task.FromResult<IReadOnlyList<BootstrapStep>>(steps);
    }

    public async IAsyncEnumerable<BootstrapStep> ExecuteStepAsync(
        string stepId,
        bool confirmed,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        BootstrapStep definition = GetExecutableStep(stepId);
        if (!confirmed)
        {
            yield return definition with { Status = BootstrapStepStatus.AwaitingConfirmation };
            yield break;
        }

        CancellationTokenSource stepCancellation = new();
        if (Interlocked.CompareExchange(ref activeStep, stepCancellation, null) is not null)
        {
            stepCancellation.Dispose();
            throw new InvalidOperationException("Another bootstrap step is already running.");
        }

        using CancellationTokenSource linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            activeStep.Token);
        try
        {
            if (stepId == "pi67-distro")
            {
                BootstrapInventory inventory = await InventoryAsync(linked.Token).ConfigureAwait(false);
                if (inventory.AgentDirectoryExists && (!inventory.AgentDirectoryIsGit || inventory.AgentDirectoryIsDirty))
                {
                    yield return definition with
                    {
                        Status = BootstrapStepStatus.Failed,
                        FailureCode = "bootstrap.agent_directory_requires_review",
                        FailureMessage = "The existing agent directory is dirty or is not a Git checkout.",
                    };
                    yield break;
                }
            }

            yield return definition with { Status = BootstrapStepStatus.Running };
            CommandInvocation invocation = GetInvocation(stepId);
            WindowsCommandResult? result = null;
            bool cancelled = false;
            try
            {
                result = await commandRunner.RunAsync(
                    invocation.FileName,
                    invocation.Arguments,
                    homeDirectory,
                    TimeSpan.FromMinutes(10),
                    linked.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                cancelled = true;
            }

            if (cancelled)
            {
                yield return definition with { Status = BootstrapStepStatus.Cancelled };
            }
            else
            {
                yield return result!.ExitCode == 0
                    ? definition with { Status = BootstrapStepStatus.Succeeded }
                    : definition with
                    {
                        Status = BootstrapStepStatus.Failed,
                        FailureCode = "bootstrap.command_failed",
                        FailureMessage = CreateBoundedFailure(result),
                    };
            }
        }
        finally
        {
            Interlocked.Exchange(ref activeStep, null)?.Dispose();
        }
    }

    public Task CancelAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        activeStep?.Cancel();
        return Task.CompletedTask;
    }

    private async Task<ComponentInventory> ProbeVersionAsync(
        string id,
        string displayName,
        string executable,
        IReadOnlyList<string> arguments,
        string testedVersion,
        CancellationToken cancellationToken)
    {
        try
        {
            WindowsCommandResult result = await commandRunner.RunAsync(
                executable,
                arguments,
                homeDirectory,
                TimeSpan.FromSeconds(10),
                cancellationToken).ConfigureAwait(false);
            string? installed = result.ExitCode == 0
                ? ExtractSemanticVersion(result.StandardOutput)
                : null;
            RuntimeCompatibility compatibility = EvaluateVersion(installed, testedVersion);
            return new ComponentInventory(
                id,
                displayName,
                installed is not null,
                installed,
                testedVersion,
                compatibility.Status,
                compatibility.Reason);
        }
        catch (Exception exception) when (exception is IOException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return new ComponentInventory(
                id,
                displayName,
                false,
                null,
                testedVersion,
                RuntimeCompatibilityStatus.Unavailable,
                $"{displayName} was not found.");
        }
    }

    private async Task<Pi67Inventory> ProbePi67Async(CancellationToken cancellationToken)
    {
        string executable = FindExecutable("pi-67.cmd") ?? FindExecutable("pi-67.exe") ?? "pi-67.cmd";
        try
        {
            WindowsCommandResult result = await commandRunner.RunAsync(
                executable,
                ["--json", "--no-remote", "version"],
                homeDirectory,
                TimeSpan.FromSeconds(20),
                cancellationToken).ConfigureAwait(false);
            if (result.ExitCode != 0)
            {
                return new(null, null);
            }

            using JsonDocument document = JsonDocument.Parse(result.StandardOutput);
            return new Pi67Inventory(
                GetNestedVersion(document.RootElement, "manager"),
                GetNestedVersion(document.RootElement, "distro"));
        }
        catch (Exception exception) when (exception is IOException or JsonException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return new(null, null);
        }
    }

    private async Task<bool> IsAgentRepositoryDirtyAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(Path.Combine(agentDirectory, ".git")))
        {
            return false;
        }

        try
        {
            WindowsCommandResult result = await commandRunner.RunAsync(
                FindExecutable("git.exe") ?? "git.exe",
                ["-C", agentDirectory, "status", "--porcelain=v1"],
                homeDirectory,
                TimeSpan.FromSeconds(10),
                cancellationToken).ConfigureAwait(false);
            return result.ExitCode != 0 || !string.IsNullOrWhiteSpace(result.StandardOutput);
        }
        catch (Exception exception) when (exception is IOException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return true;
        }
    }

    private static void AddMissingStep(
        List<BootstrapStep> steps,
        BootstrapInventory inventory,
        string id,
        string displayName,
        string description,
        string source,
        string command,
        bool requiresElevation)
    {
        if (inventory.Components.Single(item => item.Id == id).IsInstalled)
        {
            return;
        }

        steps.Add(new BootstrapStep(
            id,
            displayName,
            description,
            source,
            command,
            requiresElevation,
            BootstrapStepStatus.AwaitingConfirmation,
            null,
            null));
    }

    private static BootstrapStep GetExecutableStep(string stepId) => stepId switch
    {
        "git" => CreateDefinition("git", "Install Git", "Microsoft WinGet / Git for Windows"),
        "node" => CreateDefinition("node", "Install Node.js 24 LTS", "Microsoft WinGet / OpenJS"),
        "pi" => CreateDefinition("pi", "Install upstream Pi", "npm registry / @earendil-works"),
        "pi67-manager" => CreateDefinition("pi67-manager", "Install pi-67 manager", "npm registry / @bigking67"),
        "pi67-distro" => CreateDefinition("pi67-distro", "Install pi-67 distro", "https://github.com/bigKING67/pi-67"),
        _ => throw new ArgumentOutOfRangeException(nameof(stepId), stepId, "Unknown bootstrap step."),
    };

    private static BootstrapStep CreateDefinition(string id, string name, string source) =>
        new(id, name, name, source, null, false, BootstrapStepStatus.Pending, null, null);

    private static CommandInvocation GetInvocation(string stepId) => stepId switch
    {
        "git" => new("winget.exe", ["install", "--id", "Git.Git", "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"]),
        "node" => new("winget.exe", ["install", "--id", "OpenJS.NodeJS.LTS", "--exact", "--source", "winget", "--silent", "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements"]),
        "pi" => new("npm.cmd", ["install", "-g", $"@earendil-works/pi-coding-agent@{TestedPiVersion}"]),
        "pi67-manager" => new("npm.cmd", ["install", "-g", $"@bigking67/pi-67@{TestedPi67Version}"]),
        "pi67-distro" => new("pi-67.cmd", ["--yes", "install"]),
        _ => throw new ArgumentOutOfRangeException(nameof(stepId), stepId, "Unknown bootstrap step."),
    };

    private static string CreateBoundedFailure(WindowsCommandResult result)
    {
        string detail = string.IsNullOrWhiteSpace(result.StandardError)
            ? result.StandardOutput
            : result.StandardError;
        detail = detail.Trim();
        return detail.Length > 2000 ? detail[..2000] : detail;
    }

    private static ComponentInventory CreatePi67Component(string id, string displayName, string? installedVersion)
    {
        RuntimeCompatibility compatibility = EvaluateVersion(installedVersion, TestedPi67Version);
        return new ComponentInventory(
            id,
            displayName,
            installedVersion is not null,
            installedVersion,
            TestedPi67Version,
            compatibility.Status,
            compatibility.Reason);
    }

    private static RuntimeCompatibility EvaluateVersion(string? installedVersion, string testedVersion)
    {
        SemanticVersion tested = SemanticVersion.Parse(testedVersion);
        SemanticVersion? installed = SemanticVersion.TryParse(installedVersion, out SemanticVersion parsed)
            ? parsed
            : null;
        return RuntimeCompatibility.Evaluate(installed, tested, tested);
    }

    private static string? ExtractSemanticVersion(string value)
    {
        foreach (string token in value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate = token.Trim('v', 'V', ',', ';');
            if (SemanticVersion.TryParse(candidate, out SemanticVersion version))
            {
                return version.ToString();
            }
        }
        return null;
    }

    private static string? GetNestedVersion(JsonElement root, string name) =>
        root.TryGetProperty(name, out JsonElement section)
        && section.TryGetProperty("version", out JsonElement version)
        && version.ValueKind is JsonValueKind.String
            ? version.GetString()
            : null;

    private static string? FindExecutable(string fileName)
    {
        string? path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        foreach (string directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate = Path.Combine(directory.Trim(), fileName);
            if (File.Exists(candidate))
            {
                return Path.GetFullPath(candidate);
            }
        }
        return null;
    }

    private sealed record Pi67Inventory(string? ManagerVersion, string? DistroVersion);

    private sealed record CommandInvocation(string FileName, IReadOnlyList<string> Arguments);
}
