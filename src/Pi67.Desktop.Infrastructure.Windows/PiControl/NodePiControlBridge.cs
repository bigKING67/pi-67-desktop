using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using Pi67.Desktop.Application.PiControl;
using Pi67.Desktop.Domain.Security;
using Pi67.Desktop.Infrastructure.Windows.Processes;
using Pi67.Desktop.PiRpc.Framing;

namespace Pi67.Desktop.Infrastructure.Windows.PiControl;

public sealed record PiControlBridgeOptions(
    string NodeExecutable,
    string BridgeEntryPath,
    string PiPackageRoot,
    string AgentDirectory,
    string WorkspacePath);

public sealed class PiControlBridgeException(string code, string message, Exception? innerException = null)
    : IOException(message, innerException)
{
    public string Code { get; } = code;
}

public sealed class NodePiControlBridge : IPiControlBridge
{
    private const int OutboundCapacity = 32;
    private const int MaximumFrameBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(30);

    private readonly PiControlBridgeOptions options;
    private readonly SemaphoreSlim startGate = new(1, 1);
    private readonly object disposeGate = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> pending = new();
    private readonly ConcurrentDictionary<string, Channel<OAuthProgress>> oauthFlows = new();

    private Process? process;
    private WindowsJobObject? job;
    private Channel<ReadOnlyMemory<byte>>? outbound;
    private CancellationTokenSource? lifetimeCancellation;
    private Task? readerTask;
    private Task? writerTask;
    private Task? exitTask;
    private Task? disposeTask;
    private int requestSequence;
    private int disposed;

    public NodePiControlBridge(PiControlBridgeOptions options)
    {
        this.options = options ?? throw new ArgumentNullException(nameof(options));
    }

    public async Task<IReadOnlyList<RedactedAuthStatus>> GetAuthStatusAsync(
        CancellationToken cancellationToken)
    {
        JsonElement data = await RequestAsync("auth.status", null, cancellationToken).ConfigureAwait(false);
        if (data.ValueKind is not JsonValueKind.Array)
        {
            throw InvalidPayload("auth.status", "array");
        }

        return data.EnumerateArray().Select(static item => new RedactedAuthStatus(
            GetRequiredString(item, "providerId"),
            GetBoolean(item, "configured"),
            GetOptionalString(item, "source") ?? "none",
            GetOptionalString(item, "accountLabel"),
            GetBoolean(item, "supportsApiKey"),
            GetBoolean(item, "supportsOAuth"))).ToArray();
    }

    public Task SetApiKeyAsync(
        string providerId,
        string apiKey,
        CancellationToken cancellationToken)
    {
        RequireText(providerId, nameof(providerId));
        if (string.IsNullOrEmpty(apiKey))
        {
            throw new ArgumentException("API key cannot be empty.", nameof(apiKey));
        }

        return RequestWithoutResultAsync(
            "auth.setApiKey",
            new Dictionary<string, object?> { ["providerId"] = providerId.Trim(), ["apiKey"] = apiKey },
            cancellationToken);
    }

    public async IAsyncEnumerable<OAuthProgress> BeginOAuthAsync(
        string providerId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        RequireText(providerId, nameof(providerId));
        await EnsureStartedAsync(cancellationToken).ConfigureAwait(false);
        string flowId = CreateRequestId();
        Channel<OAuthProgress> progress = Channel.CreateBounded<OAuthProgress>(
            new BoundedChannelOptions(32)
            {
                SingleReader = true,
                SingleWriter = true,
                FullMode = BoundedChannelFullMode.Wait,
                AllowSynchronousContinuations = false,
            });
        if (!oauthFlows.TryAdd(flowId, progress))
        {
            throw new InvalidOperationException($"Duplicate OAuth flow id: {flowId}");
        }

        Task<JsonElement> completion;
        try
        {
            completion = QueueRequestAsync(
                flowId,
                "auth.loginOAuth",
                new Dictionary<string, object?> { ["providerId"] = providerId.Trim() },
                cancellationToken);
        }
        catch
        {
            oauthFlows.TryRemove(flowId, out _);
            throw;
        }

        try
        {
            await foreach (OAuthProgress item in progress.Reader.ReadAllAsync(cancellationToken))
            {
                yield return item;
            }

            _ = await completion.ConfigureAwait(false);
        }
        finally
        {
            oauthFlows.TryRemove(flowId, out _);
            if (!completion.IsCompleted)
            {
                using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(5));
                try
                {
                    await CancelOAuthAsync(flowId, timeout.Token).ConfigureAwait(false);
                    _ = await completion.WaitAsync(timeout.Token).ConfigureAwait(false);
                }
                catch (Exception exception) when (exception is OperationCanceledException
                    or PiControlBridgeException
                    or IOException
                    or ChannelClosedException)
                {
                    // Preserve the caller's cancellation or early-enumeration outcome after observing cleanup.
                }
            }
        }
    }

    public Task RespondToOAuthAsync(
        string flowId,
        string interactionId,
        string? value,
        CancellationToken cancellationToken)
    {
        RequireText(flowId, nameof(flowId));
        RequireText(interactionId, nameof(interactionId));
        return RequestWithoutResultAsync(
            "oauth.respond",
            new Dictionary<string, object?>
            {
                ["flowId"] = flowId.Trim(),
                ["interactionId"] = interactionId.Trim(),
                ["value"] = value,
            },
            cancellationToken);
    }

    public Task CancelOAuthAsync(string flowId, CancellationToken cancellationToken)
    {
        RequireText(flowId, nameof(flowId));
        return RequestWithoutResultAsync(
            "oauth.cancel",
            new Dictionary<string, object?> { ["flowId"] = flowId.Trim() },
            cancellationToken);
    }

    public Task LogoutAsync(string providerId, CancellationToken cancellationToken)
    {
        RequireText(providerId, nameof(providerId));
        return RequestWithoutResultAsync(
            "auth.logout",
            new Dictionary<string, object?> { ["providerId"] = providerId.Trim() },
            cancellationToken);
    }

    public async Task<IReadOnlyList<PiModelSummary>> ListModelsAsync(
        CancellationToken cancellationToken)
    {
        JsonElement data = await RequestAsync("models.list", null, cancellationToken).ConfigureAwait(false);
        if (data.ValueKind is not JsonValueKind.Array)
        {
            throw InvalidPayload("models.list", "array");
        }

        return data.EnumerateArray().Select(static item => new PiModelSummary(
            GetRequiredString(item, "provider"),
            GetRequiredString(item, "id"),
            GetRequiredString(item, "displayName"),
            GetStringArray(item, "thinkingLevels"),
            GetBoolean(item, "supportsImages"),
            GetBoolean(item, "isDefault"))).ToArray();
    }

    public Task RefreshModelsAsync(CancellationToken cancellationToken) =>
        RequestWithoutResultAsync("models.refresh", null, cancellationToken);

    public Task<JsonElement> GetSettingsAsync(CancellationToken cancellationToken) =>
        RequestAsync("settings.inspect", null, cancellationToken);

    public Task UpdateDefaultsAsync(
        string providerId,
        string modelId,
        CancellationToken cancellationToken)
    {
        RequireText(providerId, nameof(providerId));
        RequireText(modelId, nameof(modelId));
        return RequestWithoutResultAsync(
            "settings.updateDefaults",
            new Dictionary<string, object?>
            {
                ["providerId"] = providerId.Trim(),
                ["modelId"] = modelId.Trim(),
            },
            cancellationToken);
    }

    public async Task<ProjectTrustStatus> InspectTrustAsync(
        string workspacePath,
        CancellationToken cancellationToken)
    {
        RequireText(workspacePath, nameof(workspacePath));
        JsonElement data = await RequestAsync(
            "trust.inspect",
            new Dictionary<string, object?> { ["workspacePath"] = Path.GetFullPath(workspacePath) },
            cancellationToken).ConfigureAwait(false);
        return ParseTrustStatus(data);
    }

    public async Task<ProjectTrustStatus> SetTrustAsync(
        string workspacePath,
        ProjectTrustDecision decision,
        CancellationToken cancellationToken)
    {
        RequireText(workspacePath, nameof(workspacePath));
        string wireDecision = decision switch
        {
            ProjectTrustDecision.TrustOnce => "trustOnce",
            ProjectTrustDecision.TrustAndPersist => "trustAndPersist",
            ProjectTrustDecision.Deny => "deny",
            _ => throw new ArgumentOutOfRangeException(nameof(decision)),
        };
        JsonElement data = await RequestAsync(
            "trust.set",
            new Dictionary<string, object?>
            {
                ["workspacePath"] = Path.GetFullPath(workspacePath),
                ["decision"] = wireDecision,
            },
            cancellationToken).ConfigureAwait(false);
        return ParseTrustStatus(data);
    }

    public ValueTask DisposeAsync()
    {
        lock (disposeGate)
        {
            disposeTask ??= DisposeCoreAsync();
            return new ValueTask(disposeTask);
        }
    }

    private async Task DisposeCoreAsync()
    {
        Interlocked.Exchange(ref disposed, 1);
        await startGate.WaitAsync().ConfigureAwait(false);
        try
        {
            outbound?.Writer.TryComplete();
            lifetimeCancellation?.Cancel();
            FailPending(new ObjectDisposedException(nameof(NodePiControlBridge)));

            if (process is { HasExited: false } activeProcess)
            {
                activeProcess.StandardInput.Close();
                using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(2));
                try
                {
                    await activeProcess.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    try
                    {
                        job?.Terminate(unchecked((uint)-1));
                    }
                    catch (Exception) when (!activeProcess.HasExited)
                    {
                        activeProcess.Kill(entireProcessTree: true);
                    }
                }
            }

            await ObserveBackgroundTasksAsync().ConfigureAwait(false);

            process?.Dispose();
            job?.Dispose();
            lifetimeCancellation?.Dispose();
        }
        finally
        {
            process = null;
            job = null;
            outbound = null;
            lifetimeCancellation = null;
            readerTask = null;
            writerTask = null;
            exitTask = null;
            startGate.Release();
        }
    }

    private async Task RequestWithoutResultAsync(
        string action,
        IReadOnlyDictionary<string, object?>? parameters,
        CancellationToken cancellationToken)
    {
        _ = await RequestAsync(action, parameters, cancellationToken).ConfigureAwait(false);
    }

    private async Task<JsonElement> RequestAsync(
        string action,
        IReadOnlyDictionary<string, object?>? parameters,
        CancellationToken cancellationToken)
    {
        using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(RequestTimeout);
        try
        {
            await EnsureStartedAsync(deadline.Token).ConfigureAwait(false);
            return await QueueRequestAsync(CreateRequestId(), action, parameters, deadline.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PiControlBridgeException(
                "bridge.timeout",
                $"Pi control bridge did not complete '{action}' within {RequestTimeout.TotalSeconds:0} seconds.",
                exception);
        }
    }

    private async Task<JsonElement> QueueRequestAsync(
        string id,
        string action,
        IReadOnlyDictionary<string, object?>? parameters,
        CancellationToken cancellationToken)
    {
        Channel<ReadOnlyMemory<byte>> writer = outbound
            ?? throw new InvalidOperationException("Pi control bridge is not running.");
        TaskCompletionSource<JsonElement> completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!pending.TryAdd(id, completion))
        {
            throw new InvalidOperationException($"Duplicate Pi control request id: {id}");
        }

        try
        {
            byte[] payload = JsonSerializer.SerializeToUtf8Bytes(new
            {
                id,
                action,
                @params = parameters,
            });
            await writer.Writer.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
            return await completion.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            pending.TryRemove(id, out _);
        }
    }

    private async Task EnsureStartedAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        if (process is { HasExited: false })
        {
            return;
        }

        await startGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
            if (process is { HasExited: false })
            {
                return;
            }

            if (process is not null)
            {
                await ResetExitedProcessAsync().ConfigureAwait(false);
            }

            ValidateOptions();
            ProcessStartInfo startInfo = new()
            {
                FileName = Path.GetFullPath(options.NodeExecutable),
                WorkingDirectory = Path.GetFullPath(options.WorkspacePath),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            startInfo.ArgumentList.Add(Path.GetFullPath(options.BridgeEntryPath));
            startInfo.Environment["PI67_DESKTOP_PI_PACKAGE_ROOT"] = Path.GetFullPath(options.PiPackageRoot);
            startInfo.Environment["PI_CODING_AGENT_DIR"] = Path.GetFullPath(options.AgentDirectory);
            startInfo.Environment["PI67_DESKTOP_WORKSPACE"] = Path.GetFullPath(options.WorkspacePath);
            startInfo.Environment["PI67_DESKTOP"] = "1";
            startInfo.Environment["PI_TELEMETRY"] = "0";

            Process activeProcess = new() { StartInfo = startInfo, EnableRaisingEvents = true };
            WindowsJobObject activeJob = WindowsJobObject.CreateKillOnClose();
            try
            {
                if (!activeProcess.Start())
                {
                    throw new InvalidOperationException("Windows did not start the Pi control bridge.");
                }

                activeJob.Assign(activeProcess.Handle);
            }
            catch
            {
                activeJob.Dispose();
                activeProcess.Dispose();
                throw;
            }

            process = activeProcess;
            job = activeJob;
            outbound = Channel.CreateBounded<ReadOnlyMemory<byte>>(
                new BoundedChannelOptions(OutboundCapacity)
                {
                    SingleReader = true,
                    SingleWriter = false,
                    FullMode = BoundedChannelFullMode.Wait,
                    AllowSynchronousContinuations = false,
                });
            lifetimeCancellation = new CancellationTokenSource();
            CancellationToken lifetime = lifetimeCancellation.Token;
            writerTask = RunWriterAsync(activeProcess, outbound.Reader, lifetime);
            readerTask = RunReaderAsync(activeProcess, lifetime);
            exitTask = MonitorExitAsync(activeProcess, lifetime);
        }
        finally
        {
            startGate.Release();
        }
    }

    private static async Task RunWriterAsync(
        Process activeProcess,
        ChannelReader<ReadOnlyMemory<byte>> reader,
        CancellationToken cancellationToken)
    {
        await foreach (ReadOnlyMemory<byte> payload in reader.ReadAllAsync(cancellationToken))
        {
            await activeProcess.StandardInput.BaseStream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
            await activeProcess.StandardInput.BaseStream.WriteAsync("\n"u8.ToArray(), cancellationToken).ConfigureAwait(false);
            await activeProcess.StandardInput.BaseStream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task RunReaderAsync(Process activeProcess, CancellationToken cancellationToken)
    {
        try
        {
            await foreach (ReadOnlyMemory<byte> frame in LfJsonlFrameReader.ReadFramesAsync(
                activeProcess.StandardOutput.BaseStream,
                MaximumFrameBytes,
                cancellationToken))
            {
                await ProcessFrameAsync(frame, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            FailPending(exception);
        }
    }

    private async Task ProcessFrameAsync(
        ReadOnlyMemory<byte> frame,
        CancellationToken cancellationToken)
    {
        JsonElement root;
        try
        {
            using JsonDocument document = JsonDocument.Parse(frame);
            root = document.RootElement.Clone();
        }
        catch (JsonException exception)
        {
            throw new PiControlBridgeException(
                "bridge.invalid_json",
                "Pi control bridge returned invalid JSON.",
                exception);
        }

        string type = GetRequiredString(root, "type");
        string? id = GetOptionalString(root, "id");
        if (type == "event" && id is not null)
        {
            await ProcessEventAsync(id, root, cancellationToken).ConfigureAwait(false);
            return;
        }

        if (type != "response" || id is null || !pending.TryRemove(id, out TaskCompletionSource<JsonElement>? completion))
        {
            return;
        }

        if (GetBoolean(root, "success"))
        {
            JsonElement data = root.TryGetProperty("data", out JsonElement dataElement)
                ? dataElement.Clone()
                : JsonSerializer.SerializeToElement(new { });
            completion.TrySetResult(data);
        }
        else
        {
            JsonElement error = root.TryGetProperty("error", out JsonElement errorElement)
                ? errorElement
                : default;
            completion.TrySetException(new PiControlBridgeException(
                GetOptionalString(error, "code") ?? "bridge.operation_failed",
                GetOptionalString(error, "message") ?? "Pi control bridge operation failed."));
        }

        if (oauthFlows.TryGetValue(id, out Channel<OAuthProgress>? flow))
        {
            flow.Writer.TryComplete();
        }
    }

    private async Task ProcessEventAsync(
        string flowId,
        JsonElement root,
        CancellationToken cancellationToken)
    {
        if (GetOptionalString(root, "event") != "oauth"
            || !oauthFlows.TryGetValue(flowId, out Channel<OAuthProgress>? flow)
            || !root.TryGetProperty("data", out JsonElement data))
        {
            return;
        }

        Uri? authorizationUri = Uri.TryCreate(
            GetOptionalString(data, "authorizationUri"),
            UriKind.Absolute,
            out Uri? parsedUri)
            ? parsedUri
            : null;
        IReadOnlyList<OAuthChoice> choices = data.TryGetProperty("choices", out JsonElement choicesElement)
            && choicesElement.ValueKind is JsonValueKind.Array
            ? choicesElement.EnumerateArray().Select(static choice => new OAuthChoice(
                GetRequiredString(choice, "id"),
                GetRequiredString(choice, "label"))).ToArray()
            : [];
        try
        {
            await flow.Writer.WriteAsync(new OAuthProgress(
                flowId,
                GetOptionalString(data, "interactionId"),
                GetOptionalString(data, "stage") ?? "progress",
                GetOptionalString(data, "message") ?? string.Empty,
                authorizationUri,
                GetOptionalString(data, "userCode"),
                GetOptionalString(data, "placeholder"),
                GetBoolean(data, "allowEmpty"),
                choices), cancellationToken).ConfigureAwait(false);
        }
        catch (ChannelClosedException)
        {
            // The UI already cancelled or completed this OAuth flow.
        }
    }

    private async Task MonitorExitAsync(Process activeProcess, CancellationToken cancellationToken)
    {
        try
        {
            await activeProcess.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return;
        }

        PiControlBridgeException exception = new(
            "bridge.process_exit",
            $"Pi control bridge exited with code {activeProcess.ExitCode}.");
        FailPending(exception);
        foreach (Channel<OAuthProgress> flow in oauthFlows.Values)
        {
            flow.Writer.TryComplete(exception);
        }
    }

    private async Task ResetExitedProcessAsync()
    {
        Process activeProcess = process
            ?? throw new InvalidOperationException("Pi control bridge process state was lost.");
        PiControlBridgeException exception = new(
            "bridge.process_exit",
            $"Pi control bridge exited with code {activeProcess.ExitCode}.");
        outbound?.Writer.TryComplete(exception);
        lifetimeCancellation?.Cancel();
        FailPending(exception);
        foreach (Channel<OAuthProgress> flow in oauthFlows.Values)
        {
            flow.Writer.TryComplete(exception);
        }

        await ObserveBackgroundTasksAsync().ConfigureAwait(false);
        activeProcess.Dispose();
        job?.Dispose();
        lifetimeCancellation?.Dispose();
        process = null;
        job = null;
        outbound = null;
        lifetimeCancellation = null;
        readerTask = null;
        writerTask = null;
        exitTask = null;
    }

    private async Task ObserveBackgroundTasksAsync()
    {
        Task[] background = new Task?[] { readerTask, writerTask, exitTask }
            .Where(static task => task is not null)
            .Cast<Task>()
            .ToArray();
        if (background.Length == 0)
        {
            return;
        }

        try
        {
            await Task.WhenAll(background).ConfigureAwait(false);
        }
        catch
        {
            // Pending requests and OAuth readers receive the decisive bridge failure separately.
        }
    }

    private void FailPending(Exception exception)
    {
        foreach ((string id, TaskCompletionSource<JsonElement> completion) in pending)
        {
            if (pending.TryRemove(id, out _))
            {
                completion.TrySetException(exception);
            }
        }
    }

    private void ValidateOptions()
    {
        foreach ((string value, string name) in new[]
        {
            (options.NodeExecutable, nameof(options.NodeExecutable)),
            (options.BridgeEntryPath, nameof(options.BridgeEntryPath)),
            (options.PiPackageRoot, nameof(options.PiPackageRoot)),
            (options.AgentDirectory, nameof(options.AgentDirectory)),
            (options.WorkspacePath, nameof(options.WorkspacePath)),
        })
        {
            RequireText(value, name);
        }

        if (!File.Exists(options.NodeExecutable))
        {
            throw new FileNotFoundException("System Node executable was not found.", options.NodeExecutable);
        }

        if (!File.Exists(options.BridgeEntryPath))
        {
            throw new FileNotFoundException("Pi control bridge entry was not found.", options.BridgeEntryPath);
        }

        if (!Directory.Exists(options.PiPackageRoot) || !Directory.Exists(options.WorkspacePath))
        {
            throw new DirectoryNotFoundException("Pi package root and workspace must exist before starting the bridge.");
        }
    }

    private string CreateRequestId() => $"control-{Interlocked.Increment(ref requestSequence):x8}";

    private static ProjectTrustStatus ParseTrustStatus(JsonElement data)
    {
        ProjectTrustState state = GetRequiredString(data, "state") switch
        {
            "trustedForProcess" => ProjectTrustState.TrustedForProcess,
            "trustedPersistently" => ProjectTrustState.TrustedPersistently,
            "denied" => ProjectTrustState.Denied,
            _ => ProjectTrustState.Unknown,
        };
        return new ProjectTrustStatus(
            GetRequiredString(data, "workspacePath"),
            state,
            GetBoolean(data, "persisted"),
            GetStringArray(data, "trustRequiringResources"),
            GetOptionalString(data, "reason") ?? string.Empty);
    }

    private static PiControlBridgeException InvalidPayload(string action, string expected) => new(
        "bridge.invalid_payload",
        $"Pi control bridge action '{action}' did not return the expected {expected} payload.");

    private static void RequireText(string value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Value cannot be empty.", parameterName);
        }
    }

    private static string GetRequiredString(JsonElement element, string propertyName) =>
        GetOptionalString(element, propertyName)
        ?? throw new PiControlBridgeException(
            "bridge.invalid_payload",
            $"Pi control bridge payload is missing '{propertyName}'.");

    private static string? GetOptionalString(JsonElement element, string propertyName) =>
        element.ValueKind is JsonValueKind.Object
        && element.TryGetProperty(propertyName, out JsonElement property)
        && property.ValueKind is JsonValueKind.String
            ? property.GetString()
            : null;

    private static bool GetBoolean(JsonElement element, string propertyName) =>
        element.ValueKind is JsonValueKind.Object
        && element.TryGetProperty(propertyName, out JsonElement property)
        && property.ValueKind is JsonValueKind.True;

    private static string[] GetStringArray(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out JsonElement property)
        && property.ValueKind is JsonValueKind.Array
            ? property.EnumerateArray()
                .Where(static item => item.ValueKind is JsonValueKind.String)
                .Select(static item => item.GetString()!)
                .ToArray()
            : [];
}
