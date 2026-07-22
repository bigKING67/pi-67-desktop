using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Application.Sessions;
using Pi67.Desktop.Domain.Sessions;
using Pi67.Desktop.PiRpc.Protocol;

namespace Pi67.Desktop.PiRpc.Sessions;

public sealed class PiSessionSupervisor : IPiSessionSupervisor
{
    private static readonly TimeSpan StateTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(30);

    private readonly IPiRuntimeLocator runtimeLocator;
    private readonly IPiRpcTransport transport;
    private readonly ISessionProjectionStore projectionStore;
    private readonly TimeProvider timeProvider;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private readonly object disposeGate = new();

    private Task? disposeTask;
    private int disposed;

    public PiSessionSupervisor(
        IPiRuntimeLocator runtimeLocator,
        IPiRpcTransport transport,
        ISessionProjectionStore projectionStore,
        TimeProvider? timeProvider = null)
    {
        this.runtimeLocator = runtimeLocator ?? throw new ArgumentNullException(nameof(runtimeLocator));
        this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
        this.projectionStore = projectionStore ?? throw new ArgumentNullException(nameof(projectionStore));
        this.timeProvider = timeProvider ?? TimeProvider.System;
    }

    public PiSessionReference? CurrentSession { get; private set; }

    public Task<PiSessionState> CreateSessionAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        CancellationToken cancellationToken) =>
        StartSessionAsync(runtime, options with { SessionPath = null }, cancellationToken);

    public Task<PiSessionState> OpenSessionAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        string sessionPath,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sessionPath))
        {
            throw new ArgumentException("Pi session path cannot be empty.", nameof(sessionPath));
        }

        return StartSessionAsync(
            runtime,
            options with { SessionPath = Path.GetFullPath(sessionPath), PersistSession = true },
            cancellationToken);
    }

    public Task<PiRpcResponse> SendPromptAsync(
        string message,
        IReadOnlyList<PiImageInput>? images,
        CancellationToken cancellationToken)
    {
        Dictionary<string, object?> arguments = CreateMessageArguments(message);
        if (images is { Count: > 0 })
        {
            arguments["images"] = images.Select(static image => new
            {
                type = "image",
                data = image.Base64Data,
                mimeType = image.MimeType,
            }).ToArray();
        }

        return SendRequiredAsync("prompt", arguments, CommandTimeout, cancellationToken);
    }

    public Task<PiRpcResponse> SteerAsync(string message, CancellationToken cancellationToken) =>
        SendRequiredAsync("steer", CreateMessageArguments(message), CommandTimeout, cancellationToken);

    public Task<PiRpcResponse> FollowUpAsync(string message, CancellationToken cancellationToken) =>
        SendRequiredAsync("follow_up", CreateMessageArguments(message), CommandTimeout, cancellationToken);

    public Task AbortAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        return transport.AbortAsync(cancellationToken);
    }

    public Task<PiRpcResponse> CompactAsync(CancellationToken cancellationToken) =>
        SendRequiredAsync("compact", arguments: null, TimeSpan.FromMinutes(5), cancellationToken);

    public Task<PiRpcResponse> AbortRetryAsync(CancellationToken cancellationToken) =>
        SendRequiredAsync("abort_retry", arguments: null, CommandTimeout, cancellationToken);

    public Task RespondToExtensionUiAsync(
        string requestId,
        IReadOnlyDictionary<string, object?> response,
        CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        if (!transport.IsRunning)
        {
            throw new InvalidOperationException("No Pi RPC session is running.");
        }

        return transport.RespondToUiAsync(requestId, response, cancellationToken);
    }

    public async Task<JsonElement> GetEntriesAsync(
        string? sinceEntryId,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<string, object?>? arguments = string.IsNullOrWhiteSpace(sinceEntryId)
            ? null
            : new Dictionary<string, object?> { ["since"] = sinceEntryId.Trim() };
        PiRpcResponse response = await SendRequiredAsync(
            "get_entries",
            arguments,
            CommandTimeout,
            cancellationToken).ConfigureAwait(false);
        return RequireData(response);
    }

    public async Task<JsonElement> GetTreeAsync(CancellationToken cancellationToken)
    {
        PiRpcResponse response = await SendRequiredAsync(
            "get_tree",
            arguments: null,
            CommandTimeout,
            cancellationToken).ConfigureAwait(false);
        return RequireData(response);
    }

    public async IAsyncEnumerable<PiRpcEvent> ReadEventsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        await foreach (PiRpcEvent rpcEvent in transport.ReadEventsAsync(cancellationToken))
        {
            yield return rpcEvent;
        }
    }

    public Task CloseSessionAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        return CloseSessionCoreAsync(cancellationToken);
    }

    private async Task CloseSessionCoreAsync(CancellationToken cancellationToken)
    {
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (transport.IsRunning)
            {
                await transport.StopAsync("session closed", cancellationToken).ConfigureAwait(false);
            }

            CurrentSession = null;
        }
        finally
        {
            lifecycleGate.Release();
        }
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
        try
        {
            await CloseSessionCoreAsync(CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            await transport.DisposeAsync().ConfigureAwait(false);
        }
    }

    private async Task<PiSessionState> StartSessionAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        ArgumentNullException.ThrowIfNull(options);
        ThrowIfDisposed();
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            if (transport.IsRunning)
            {
                throw new InvalidOperationException("Close the active Pi session before opening another session.");
            }

            PiRuntimeLaunchPlan plan = await runtimeLocator
                .BuildLaunchPlanAsync(runtime, options, cancellationToken)
                .ConfigureAwait(false);
            await transport.StartAsync(plan, cancellationToken).ConfigureAwait(false);
            try
            {
                PiRpcResponse response = await transport.SendAsync(
                    "get_state",
                    arguments: null,
                    StateTimeout,
                    cancellationToken).ConfigureAwait(false);
                PiSessionState state = ParseState(response);
                CurrentSession = await ProjectSessionAsync(state, options, cancellationToken).ConfigureAwait(false);
                return state;
            }
            catch
            {
                await transport.StopAsync("session startup failed", CancellationToken.None).ConfigureAwait(false);
                throw;
            }
        }
        finally
        {
            lifecycleGate.Release();
        }
    }

    private async Task<PiSessionReference?> ProjectSessionAsync(
        PiSessionState state,
        PiSessionLaunchOptions options,
        CancellationToken cancellationToken)
    {
        if (!options.PersistSession)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(state.SessionFile))
        {
            throw new PiRpcProtocolException(
                "rpc.missing_session_file",
                "Pi reported a persistent session without a session file.");
        }

        string sessionPath = Path.GetFullPath(state.SessionFile);
        string threadId = CreateDesktopThreadId(state.SessionId, sessionPath);
        PiSessionReference reference = new(
            threadId,
            Path.GetFullPath(options.WorkspacePath),
            sessionPath,
            state.SessionId,
            state.SessionName,
            timeProvider.GetUtcNow());
        await projectionStore.UpsertSessionAsync(reference, cancellationToken).ConfigureAwait(false);
        return reference;
    }

    private async Task<PiRpcResponse> SendRequiredAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        if (!transport.IsRunning)
        {
            throw new InvalidOperationException("No Pi RPC session is running.");
        }

        return await transport.SendAsync(command, arguments, timeout, cancellationToken)
            .ConfigureAwait(false);
    }

    private static PiSessionState ParseState(PiRpcResponse response)
    {
        JsonElement state = RequireData(response);
        JsonElement model = state.TryGetProperty("model", out JsonElement modelElement)
            ? modelElement
            : default;
        return new PiSessionState(
            GetOptionalString(state, "sessionFile"),
            GetOptionalString(state, "sessionId"),
            GetOptionalString(state, "sessionName"),
            GetBoolean(state, "isStreaming"),
            GetBoolean(state, "isCompacting"),
            GetOptionalString(state, "thinkingLevel") ?? "off",
            model.ValueKind is JsonValueKind.Object ? GetOptionalString(model, "provider") : null,
            model.ValueKind is JsonValueKind.Object ? GetOptionalString(model, "id") : null,
            GetInt32(state, "messageCount"),
            GetInt32(state, "pendingMessageCount"),
            state.Clone());
    }

    private static JsonElement RequireData(PiRpcResponse response)
    {
        if (!response.Success)
        {
            throw new PiRpcProtocolException(
                "rpc.command_failed",
                $"Pi RPC command '{response.Command}' failed: {response.Error ?? "unknown error"}");
        }

        if (response.Data is not { ValueKind: JsonValueKind.Object } data)
        {
            throw new PiRpcProtocolException(
                "rpc.missing_data",
                $"Pi RPC command '{response.Command}' did not return an object data payload.");
        }

        return data.Clone();
    }

    private static Dictionary<string, object?> CreateMessageArguments(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            throw new ArgumentException("Pi message cannot be empty.", nameof(message));
        }

        return new Dictionary<string, object?> { ["message"] = message };
    }

    private static string CreateDesktopThreadId(string? sessionId, string sessionPath)
    {
        if (!string.IsNullOrWhiteSpace(sessionId))
        {
            return $"pi-session:{sessionId.Trim()}";
        }

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(sessionPath));
        return $"pi-path:{Convert.ToHexString(hash.AsSpan(0, 12)).ToLowerInvariant()}";
    }

    private static string? GetOptionalString(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement property)
        && property.ValueKind is JsonValueKind.String
            ? property.GetString()
            : null;

    private static bool GetBoolean(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement property)
        && property.ValueKind is JsonValueKind.True;

    private static int GetInt32(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement property)
        && property.TryGetInt32(out int value)
            ? value
            : 0;

    private void ThrowIfDisposed() =>
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
}
