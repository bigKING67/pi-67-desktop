using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Domain.Security;

namespace Pi67.Desktop.Infrastructure.Windows.Runtime;

public sealed record PiRuntimeLocatorOptions(
    SemanticVersion TestedVersion,
    SemanticVersion MinimumVersion,
    string AgentDirectory)
{
    public static PiRuntimeLocatorOptions CreateDefault() => new(
        SemanticVersion.Parse("0.80.6"),
        SemanticVersion.Parse("0.80.0"),
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".pi",
            "agent"));
}

public sealed class WindowsPiRuntimeLocator : IPiRuntimeLocator
{
    private static readonly string[] PackageNames =
    [
        "@earendil-works/pi-coding-agent",
        "@mariozechner/pi-coding-agent",
    ];

    private readonly PiRuntimeLocatorOptions options;

    public WindowsPiRuntimeLocator(PiRuntimeLocatorOptions? options = null)
    {
        this.options = options ?? PiRuntimeLocatorOptions.CreateDefault();
    }

    public async Task<PiRuntimeDescriptor> LocateAsync(CancellationToken cancellationToken)
    {
        string? explicitExecutable = Environment.GetEnvironmentVariable("PI67_DESKTOP_PI_EXECUTABLE");
        IEnumerable<string> shims = string.IsNullOrWhiteSpace(explicitExecutable)
            ? EnumeratePiShims()
            : [Path.GetFullPath(explicitExecutable)];

        string? nodeExecutable = FindExecutable("node.exe") ?? FindExecutable("node");
        foreach (string shim in shims)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!File.Exists(shim))
            {
                continue;
            }

            if (nodeExecutable is not null
                && TryFindPackageEntry(Path.GetDirectoryName(shim), out string? packageRoot, out string? entryPoint))
            {
                return await DescribeAsync(
                    entryPoint!,
                    nodeExecutable,
                    packageRoot,
                    PiRuntimeLauncherKind.NodePackageEntry,
                    "installed-pi-package",
                    cancellationToken).ConfigureAwait(false);
            }

            PiRuntimeLauncherKind kind = Path.GetExtension(shim) is ".cmd" or ".bat"
                ? PiRuntimeLauncherKind.CommandShim
                : PiRuntimeLauncherKind.NativeExecutable;
            return await DescribeAsync(
                shim,
                null,
                null,
                kind,
                "path",
                cancellationToken).ConfigureAwait(false);
        }

        if (nodeExecutable is not null
            && TryFindPackageEntry(null, out string? globalPackageRoot, out string? globalEntryPoint))
        {
            return await DescribeAsync(
                globalEntryPoint!,
                nodeExecutable,
                globalPackageRoot,
                PiRuntimeLauncherKind.NodePackageEntry,
                "installed-pi-package",
                cancellationToken).ConfigureAwait(false);
        }

        RuntimeCompatibility compatibility = RuntimeCompatibility.Evaluate(
            installed: null,
            options.TestedVersion,
            options.MinimumVersion);
        return new PiRuntimeDescriptor(
            Executable: string.Empty,
            NodeExecutable: nodeExecutable,
            PackageRoot: null,
            options.AgentDirectory,
            RawVersion: null,
            compatibility,
            PiRuntimeLauncherKind.NativeExecutable,
            Source: "not-found");
    }

    public Task<PiRuntimeDescriptor> ValidateAsync(
        PiRuntimeDescriptor runtime,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        if (string.IsNullOrWhiteSpace(runtime.Executable))
        {
            return Task.FromResult(runtime);
        }

        return DescribeAsync(
            runtime.Executable,
            runtime.NodeExecutable,
            runtime.PackageRoot,
            runtime.LauncherKind,
            runtime.Source,
            cancellationToken);
    }

    public Task<PiRuntimeLaunchPlan> BuildLaunchPlanAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        ArgumentNullException.ThrowIfNull(options);
        cancellationToken.ThrowIfCancellationRequested();

        if (!runtime.Compatibility.CanRunRpc)
        {
            throw new InvalidOperationException(runtime.Compatibility.Reason);
        }

        string workspace = Path.GetFullPath(options.WorkspacePath);
        if (!Directory.Exists(workspace))
        {
            throw new DirectoryNotFoundException($"Pi workspace does not exist: {workspace}");
        }

        List<string> arguments = [];
        string fileName;
        if (runtime.LauncherKind is PiRuntimeLauncherKind.NodePackageEntry)
        {
            fileName = runtime.NodeExecutable
                ?? throw new InvalidOperationException("The Pi package requires a compatible system Node executable.");
            arguments.Add(runtime.Executable);
        }
        else
        {
            fileName = runtime.Executable;
        }

        arguments.Add("--mode");
        arguments.Add("rpc");
        arguments.Add(options.ProjectTrustDecision is ProjectTrustDecision.Deny
            ? "--no-approve"
            : "--approve");
        if (!options.PersistSession)
        {
            arguments.Add("--no-session");
        }

        if (!string.IsNullOrWhiteSpace(options.SessionPath))
        {
            arguments.Add("--session");
            arguments.Add(Path.GetFullPath(options.SessionPath));
        }

        if (!string.IsNullOrWhiteSpace(options.SessionName))
        {
            arguments.Add("--name");
            arguments.Add(options.SessionName.Trim());
        }

        if (options.Offline)
        {
            arguments.Add("--offline");
        }

        foreach (string extensionPath in options.ExtensionPaths)
        {
            arguments.Add("--extension");
            arguments.Add(Path.GetFullPath(extensionPath));
        }

        Dictionary<string, string?> environment = new(StringComparer.OrdinalIgnoreCase)
        {
            ["PI_CODING_AGENT_DIR"] = runtime.AgentDirectory,
            ["PI67_DESKTOP"] = "1",
            ["PI_TELEMETRY"] = "0",
        };
        if (options.Offline)
        {
            environment["PI_OFFLINE"] = "1";
        }

        return Task.FromResult(new PiRuntimeLaunchPlan(
            fileName,
            arguments,
            workspace,
            environment,
            runtime));
    }

    private async Task<PiRuntimeDescriptor> DescribeAsync(
        string executable,
        string? nodeExecutable,
        string? packageRoot,
        PiRuntimeLauncherKind launcherKind,
        string source,
        CancellationToken cancellationToken)
    {
        string fileName = launcherKind is PiRuntimeLauncherKind.NodePackageEntry
            ? nodeExecutable ?? throw new InvalidOperationException("Node executable is required for the Pi package entry.")
            : executable;
        List<string> arguments = launcherKind is PiRuntimeLauncherKind.NodePackageEntry
            ? [executable, "--version"]
            : ["--version"];

        string? rawVersion = await ProbeVersionAsync(
            fileName,
            arguments,
            launcherKind is PiRuntimeLauncherKind.CommandShim,
            cancellationToken).ConfigureAwait(false);
        SemanticVersion? installed = SemanticVersion.TryParse(rawVersion, out SemanticVersion parsed)
            ? parsed
            : null;
        RuntimeCompatibility compatibility = RuntimeCompatibility.Evaluate(
            installed,
            options.TestedVersion,
            options.MinimumVersion);
        if (rawVersion is not null && installed is null)
        {
            compatibility = compatibility with
            {
                Status = RuntimeCompatibilityStatus.Incompatible,
                Reason = $"Pi returned an unrecognized version: {rawVersion}",
            };
        }

        return new PiRuntimeDescriptor(
            executable,
            nodeExecutable,
            packageRoot,
            options.AgentDirectory,
            rawVersion,
            compatibility,
            launcherKind,
            source);
    }

    private static async Task<string?> ProbeVersionAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        bool commandShim,
        CancellationToken cancellationToken)
    {
        ProcessStartInfo startInfo = new()
        {
            FileName = commandShim
                ? Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe"
                : fileName,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (commandShim)
        {
            startInfo.ArgumentList.Add("/d");
            startInfo.ArgumentList.Add("/s");
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add($"\"{fileName.Replace("\"", "\"\"", StringComparison.Ordinal)}\" --version");
        }
        else
        {
            foreach (string argument in arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }
        }

        using Process process = new() { StartInfo = startInfo };
        try
        {
            if (!process.Start())
            {
                return null;
            }

            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            Task<string> stdoutTask = ReadBoundedAsync(process.StandardOutput, timeout.Token);
            Task<string> stderrTask = ReadBoundedAsync(process.StandardError, timeout.Token);
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            string stdout = await stdoutTask.ConfigureAwait(false);
            string stderr = await stderrTask.ConfigureAwait(false);
            string output = string.IsNullOrWhiteSpace(stdout) ? stderr : stdout;
            return ExtractVersion(output);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }

            return null;
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        const int limit = 16 * 1024;
        char[] buffer = new char[limit];
        int length = 0;
        while (length < buffer.Length)
        {
            int count = await reader.ReadAsync(buffer.AsMemory(length, buffer.Length - length), cancellationToken)
                .ConfigureAwait(false);
            if (count == 0)
            {
                break;
            }

            length += count;
        }

        return new string(buffer, 0, length);
    }

    private static string? ExtractVersion(string output)
    {
        foreach (string token in output.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate = token.Trim('v', 'V', ',', ';');
            if (SemanticVersion.TryParse(candidate, out SemanticVersion version))
            {
                return version.ToString();
            }
        }

        return null;
    }

    private static IEnumerable<string> EnumeratePiShims()
    {
        HashSet<string> yielded = new(StringComparer.OrdinalIgnoreCase);
        foreach (string fileName in new[] { "pi.exe", "pi.cmd", "pi.bat", "pi" })
        {
            string? candidate = FindExecutable(fileName);
            if (candidate is not null && yielded.Add(candidate))
            {
                yield return candidate;
            }
        }

        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrWhiteSpace(appData))
        {
            string npmShim = Path.Combine(appData, "npm", "pi.cmd");
            if (File.Exists(npmShim) && yielded.Add(npmShim))
            {
                yield return npmShim;
            }
        }
    }

    private static string? FindExecutable(string fileName)
    {
        if (Path.IsPathFullyQualified(fileName))
        {
            return File.Exists(fileName) ? Path.GetFullPath(fileName) : null;
        }

        string? path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        foreach (string directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate;
            try
            {
                candidate = Path.Combine(directory.Trim(), fileName);
            }
            catch (ArgumentException)
            {
                continue;
            }

            if (File.Exists(candidate))
            {
                return Path.GetFullPath(candidate);
            }
        }

        return null;
    }

    private static bool TryFindPackageEntry(
        string? shimDirectory,
        out string? packageRoot,
        out string? entryPoint)
    {
        foreach (string root in EnumeratePackageRoots(shimDirectory))
        {
            string manifestPath = Path.Combine(root, "package.json");
            if (!File.Exists(manifestPath))
            {
                continue;
            }

            try
            {
                using JsonDocument manifest = JsonDocument.Parse(File.ReadAllBytes(manifestPath));
                JsonElement bin = manifest.RootElement.GetProperty("bin");
                string? relative = bin.ValueKind switch
                {
                    JsonValueKind.String => bin.GetString(),
                    JsonValueKind.Object when bin.TryGetProperty("pi", out JsonElement pi) => pi.GetString(),
                    _ => null,
                };
                if (string.IsNullOrWhiteSpace(relative))
                {
                    continue;
                }

                string candidate = Path.GetFullPath(Path.Combine(root, relative));
                if (File.Exists(candidate))
                {
                    packageRoot = root;
                    entryPoint = candidate;
                    return true;
                }
            }
            catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
            {
            }
        }

        packageRoot = null;
        entryPoint = null;
        return false;
    }

    private static HashSet<string> EnumeratePackageRoots(string? shimDirectory)
    {
        HashSet<string> roots = new(StringComparer.OrdinalIgnoreCase);
        string? explicitPackage = Environment.GetEnvironmentVariable("PI_PACKAGE_DIR");
        if (!string.IsNullOrWhiteSpace(explicitPackage))
        {
            roots.Add(Path.GetFullPath(explicitPackage));
        }

        List<string> moduleRoots = [];
        if (!string.IsNullOrWhiteSpace(shimDirectory))
        {
            moduleRoots.Add(Path.Combine(shimDirectory, "node_modules"));
        }

        string? npmPrefix = Environment.GetEnvironmentVariable("NPM_CONFIG_PREFIX");
        if (!string.IsNullOrWhiteSpace(npmPrefix))
        {
            moduleRoots.Add(Path.Combine(npmPrefix, "node_modules"));
        }

        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrWhiteSpace(appData))
        {
            moduleRoots.Add(Path.Combine(appData, "npm", "node_modules"));
        }

        foreach (string moduleRoot in moduleRoots)
        {
            foreach (string packageName in PackageNames)
            {
                roots.Add(Path.GetFullPath(Path.Combine(moduleRoot, packageName.Replace('/', Path.DirectorySeparatorChar))));
            }
        }

        return roots;
    }
}
