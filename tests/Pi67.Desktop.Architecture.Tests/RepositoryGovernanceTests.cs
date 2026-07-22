using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Pi67.Desktop.Architecture.Tests;

public sealed partial class RepositoryGovernanceTests
{
    [Fact]
    public void ChineseAndEnglishResourcesHaveExactKeyParity()
    {
        string root = FindRepositoryRoot();
        HashSet<string> chinese = ReadResourceKeys(Path.Combine(
            root,
            "src/Pi67.Desktop.App/Strings/zh-CN/Resources.resw"));
        HashSet<string> english = ReadResourceKeys(Path.Combine(
            root,
            "src/Pi67.Desktop.App/Strings/en-US/Resources.resw"));

        Assert.Empty(chinese.Except(english));
        Assert.Empty(english.Except(chinese));

        string shellText = File.ReadAllText(Path.Combine(
            root,
            "src/Pi67.Desktop.Presentation/Shell/ShellText.cs"));
        string[] presentationKeys = ShellTextKeyPattern().Matches(shellText)
            .Select(static match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        Assert.All(presentationKeys, key => Assert.Contains(key, chinese));
    }

    [Fact]
    public void ProductionSourceDoesNotBypassNativeStackOrRustGate()
    {
        string root = FindRepositoryRoot();
        string[] sourceFiles = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}.git{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !file.Contains($"{Path.DirectorySeparatorChar}.nuget{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !file.Contains($"{Path.DirectorySeparatorChar}node_modules{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .ToArray();

        Assert.DoesNotContain(sourceFiles, static file => Path.GetExtension(file).Equals(".rs", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(sourceFiles, static file => Path.GetFileName(file).Equals("Cargo.toml", StringComparison.OrdinalIgnoreCase));

        string[] projectFiles = sourceFiles.Where(static file =>
            Path.GetExtension(file) is ".csproj" or ".props"
            || Path.GetFileName(file).Equals("package.json", StringComparison.OrdinalIgnoreCase)).ToArray();
        foreach (string projectFile in projectFiles)
        {
            string contents = File.ReadAllText(projectFile);
            Assert.DoesNotContain("Electron", contents, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("WebView2", contents, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void ReleaseWorkflowPinsImmutableSourceAndReplaysInstalledPiEvidence()
    {
        string root = FindRepositoryRoot();
        string workflow = File.ReadAllText(Path.Combine(root, ".github/workflows/release-alpha.yml"));

        Assert.Contains("^[0-9a-fA-F]{40}$", workflow, StringComparison.Ordinal);
        Assert.Contains("PI67_SOURCE_REVISION=$actual", workflow, StringComparison.Ordinal);
        Assert.Contains("target_commitish: ${{ inputs.source_ref }}", workflow, StringComparison.Ordinal);
        Assert.Contains("@earendil-works/pi-coding-agent@0.80.6", workflow, StringComparison.Ordinal);
        Assert.Contains("PI67_RUN_LIVE_PI_TESTS", workflow, StringComparison.Ordinal);
        Assert.Contains("PI67_TEST_PI_PACKAGE_ROOT", workflow, StringComparison.Ordinal);
        Assert.Contains("npm run version:verify", workflow, StringComparison.Ordinal);
        Assert.Contains("npm run release:manifest", workflow, StringComparison.Ordinal);
        Assert.Contains("npm run release:verify", workflow, StringComparison.Ordinal);
    }

    [Fact]
    public void ContinuousIntegrationVerifiesVersionAndExactReleaseArtifacts()
    {
        string root = FindRepositoryRoot();
        string workflow = File.ReadAllText(Path.Combine(root, ".github/workflows/ci.yml"));

        Assert.Contains("npm run version:verify", workflow, StringComparison.Ordinal);
        Assert.Contains("npm run release:manifest", workflow, StringComparison.Ordinal);
        Assert.Contains("npm run release:verify", workflow, StringComparison.Ordinal);
    }

    [Fact]
    public void ContinuousIntegrationBuildsCoreTestsBeforeExecution()
    {
        string root = FindRepositoryRoot();
        string workflow = File.ReadAllText(Path.Combine(root, ".github/workflows/ci.yml"));

        Assert.DoesNotContain(
            "dotnet test $project --configuration Release --no-build --no-restore",
            workflow,
            StringComparison.Ordinal);
        Assert.Contains(
            "dotnet test $project --configuration Release --no-restore",
            workflow,
            StringComparison.Ordinal);
    }

    [Fact]
    public void MarkdownLinksRequireTheNativeOneShotApprovalPath()
    {
        string root = FindRepositoryRoot();
        string markdownView = File.ReadAllText(Path.Combine(
            root,
            "src/Pi67.Desktop.App/Controls/NativeMarkdownView.cs"));
        string shell = File.ReadAllText(Path.Combine(
            root,
            "src/Pi67.Desktop.App/Views/ShellPage.xaml.cs"));

        Assert.DoesNotContain("NavigateUri", markdownView, StringComparison.Ordinal);
        Assert.Contains("ExternalLinkRequested", markdownView, StringComparison.Ordinal);
        Assert.Contains("Dialog.ExternalLinkTitle", shell, StringComparison.Ordinal);
        Assert.Contains("Launcher.LaunchUriAsync(args.Uri)", shell, StringComparison.Ordinal);
    }

    [Fact]
    public void BootstrapInventoryCommandsMatchTheExecutableCoordinatorPlan()
    {
        string root = FindRepositoryRoot();
        string coordinator = File.ReadAllText(Path.Combine(
            root,
            "src/Pi67.Desktop.Infrastructure.Windows/Bootstrap/WindowsBootstrapCoordinator.cs"));
        using JsonDocument inventory = JsonDocument.Parse(File.ReadAllText(Path.Combine(
            root,
            "eng/packaging/bootstrap-inventory.json")));

        foreach (JsonElement step in inventory.RootElement.GetProperty("steps").EnumerateArray())
        {
            string command = step.GetProperty("command").GetString()
                ?? throw new InvalidDataException("Bootstrap command cannot be null.");
            if (!command.StartsWith("npm install ", StringComparison.Ordinal))
            {
                Assert.Contains(command, coordinator, StringComparison.Ordinal);
                continue;
            }

            string package = command.Split(' ', StringSplitOptions.RemoveEmptyEntries)[^1];
            int versionSeparator = package.LastIndexOf('@');
            Assert.True(versionSeparator > 0, $"Versioned npm package was expected: {package}");
            Assert.Contains(package[..versionSeparator], coordinator, StringComparison.Ordinal);
            Assert.Contains($"\"{package[(versionSeparator + 1)..]}\"", coordinator, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void OAuthInteractionEventsApplyBackpressureInsteadOfBeingDropped()
    {
        string root = FindRepositoryRoot();
        string bridge = File.ReadAllText(Path.Combine(
            root,
            "src/Pi67.Desktop.Infrastructure.Windows/PiControl/NodePiControlBridge.cs"));

        Assert.Contains("flow.Writer.WriteAsync(new OAuthProgress", bridge, StringComparison.Ordinal);
        Assert.DoesNotContain("flow.Writer.TryWrite(new OAuthProgress", bridge, StringComparison.Ordinal);
    }

    [Fact]
    public void PiControlBridgeRechecksDisposalAfterTakingTheStartGate()
    {
        string root = FindRepositoryRoot();
        string bridge = File.ReadAllText(Path.Combine(
            root,
            "src/Pi67.Desktop.Infrastructure.Windows/PiControl/NodePiControlBridge.cs"))
            .ReplaceLineEndings("\n");

        Assert.Contains(
            "await startGate.WaitAsync(cancellationToken).ConfigureAwait(false);\n        try\n        {\n            ObjectDisposedException.ThrowIf",
            bridge,
            StringComparison.Ordinal);
        Assert.DoesNotContain("startGate.Dispose();", bridge, StringComparison.Ordinal);
        Assert.Contains("await ResetExitedProcessAsync().ConfigureAwait(false);", bridge, StringComparison.Ordinal);
        Assert.Contains("await completion.WaitAsync(timeout.Token).ConfigureAwait(false);", bridge, StringComparison.Ordinal);
    }

    [Fact]
    public void WindowShutdownCancelsInitializationBeforeDisposal()
    {
        string root = FindRepositoryRoot();
        string window = File.ReadAllText(Path.Combine(root, "src/Pi67.Desktop.App/MainWindow.xaml.cs"))
            .ReplaceLineEndings("\n");

        Assert.Contains("await viewModel.InitializeAsync(lifetime.Token);", window, StringComparison.Ordinal);
        Assert.Contains("catch (OperationCanceledException) when (lifetime.IsCancellationRequested)", window, StringComparison.Ordinal);
        Assert.Contains("lifetime.Cancel();\n        Shell.Dispose();", window, StringComparison.Ordinal);
    }

    private static HashSet<string> ReadResourceKeys(string path) => XDocument.Load(path)
        .Root!
        .Elements("data")
        .Select(static element => (string?)element.Attribute("name"))
        .Where(static name => name is not null)
        .Select(static name => name!)
        .ToHashSet(StringComparer.Ordinal);

    private static string FindRepositoryRoot()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Directory.Build.props")))
        {
            directory = directory.Parent;
        }
        return directory?.FullName ?? throw new DirectoryNotFoundException("Repository root was not found.");
    }

    [GeneratedRegex("\\[\\\"([^\\\"]+)\\\"\\]\\s*=", RegexOptions.CultureInvariant)]
    private static partial Regex ShellTextKeyPattern();
}
