using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.PiRpc.Framing;
using Pi67.Desktop.PiRpc.Protocol;

namespace Pi67.Desktop.PiRpc.Transport;

public sealed class PiRpcTransport : IPiRpcTransport
{
    private const int OutboundCapacity = 128;
    private const int EventCapacity = 1024;
    private const int StderrLimitBytes = 1024 * 1024;

    private readonly IPiRpcProcessFactory processFactory;
    private readonly TimeProvider timeProvider;
    private readonly SemaphoreSlim lifecycleGate = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<PiRpcResponse>> pending = new();
    private readonly object stderrGate = new();
    private readonly object disposeGate = new();
    private readonly MemoryStream stderrBuffer = new();

    private Channel<OutboundMessage>? outbound;
    private Channel<PiRpcEvent>? events;
    private CancellationTokenSource? lifetimeCancellation;
    private IPiRpcProcess? process;
    private Task? writerTask;
    private Task? readerTask;
    private Task? stderrTask;
    private Task? exitTask;
    private Task? disposeTask;
    private int requestSequence;
    private int stopStarted;
    private int disposed;

    public PiRpcTransport(IPiRpcProcessFactory processFactory, TimeProvider? timeProvider = null)
    {
        this.processFactory = processFactory ?? throw new ArgumentNullException(nameof(processFactory));
        this.timeProvider = timeProvider ?? TimeProvider.System;
    }

    public bool IsRunning => process is { HasExited: false } && Volatile.Read(ref stopStarted) == 0;

    public async Task StartAsync(
        PiRuntimeLaunchPlan launchPlan,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(launchPlan);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
            if (process is not null)
            {
                throw new InvalidOperationException("Pi RPC transport has already been started.");
            }

            outbound = Channel.CreateBounded<OutboundMessage>(
                new BoundedChannelOptions(OutboundCapacity)
                {
                    FullMode = BoundedChannelFullMode.Wait,
                    SingleReader = true,
                    SingleWriter = false,
                    AllowSynchronousContinuations = false,
                });
            events = Channel.CreateBounded<PiRpcEvent>(
                new BoundedChannelOptions(EventCapacity)
                {
                    FullMode = BoundedChannelFullMode.Wait,
                    SingleReader = false,
                    SingleWriter = true,
                    AllowSynchronousContinuations = false,
                });

            lifetimeCancellation = new CancellationTokenSource();
            process = await processFactory.StartAsync(launchPlan, cancellationToken).ConfigureAwait(false);
            Volatile.Write(ref stopStarted, 0);
            lock (stderrGate)
            {
                stderrBuffer.SetLength(0);
            }
            CancellationToken lifetime = lifetimeCancellation.Token;
            writerTask = RunWriterAsync(process, outbound.Reader, lifetime);
            readerTask = RunReaderAsync(process, events.Writer, lifetime);
            stderrTask = CaptureStderrAsync(process, lifetime);
            exitTask = MonitorExitAsync(process, lifetime);
        }
        catch
        {
            lifetimeCancellation?.Dispose();
            lifetimeCancellation = null;
            process = null;
            outbound = null;
            events = null;
            throw;
        }
        finally
        {
            lifecycleGate.Release();
        }
    }

    public async Task<PiRpcResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command))
        {
            throw new ArgumentException("RPC command cannot be empty.", nameof(command));
        }

        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(timeout, TimeSpan.Zero);

        Channel<OutboundMessage> activeOutbound = outbound
            ?? throw new InvalidOperationException("Pi RPC transport is not running.");

        string id = $"desktop-{Interlocked.Increment(ref requestSequence):x8}";
        TaskCompletionSource<PiRpcResponse> completion = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!pending.TryAdd(id, completion))
        {
            throw new InvalidOperationException($"Duplicate Pi RPC request id: {id}");
        }

        try
        {
            byte[] payload = SerializeCommand(id, command.Trim(), arguments);
            await activeOutbound.Writer
                .WriteAsync(new OutboundMessage(payload), cancellationToken)
                .ConfigureAwait(false);

            return await completion.Task
                .WaitAsync(timeout, timeProvider, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (TimeoutException exception)
        {
            throw new PiRpcProtocolException(
                "rpc.request_timeout",
                $"Pi RPC command '{command}' timed out after {timeout}.",
                exception);
        }
        finally
        {
            pending.TryRemove(id, out _);
        }
    }

    public async Task RespondToUiAsync(
        string requestId,
        object? result,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(requestId))
        {
            throw new ArgumentException("UI request id cannot be empty.", nameof(requestId));
        }

        Channel<OutboundMessage> activeOutbound = outbound
            ?? throw new InvalidOperationException("Pi RPC transport is not running.");

        Dictionary<string, object?> response = new(StringComparer.Ordinal)
        {
            ["type"] = "extension_ui_response",
            ["id"] = requestId,
        };

        if (result is IReadOnlyDictionary<string, object?> fields)
        {
            foreach ((string key, object? value) in fields)
            {
                if (key is not ("type" or "id"))
                {
                    response[key] = value;
                }
            }
        }
        else
        {
            response["value"] = result;
        }

        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(response);
        await activeOutbound.Writer
            .WriteAsync(new OutboundMessage(payload), cancellationToken)
            .ConfigureAwait(false);
    }

    public async IAsyncEnumerable<PiRpcEvent> ReadEventsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        Channel<PiRpcEvent> activeEvents = events
            ?? throw new InvalidOperationException("Pi RPC transport is not running.");

        await foreach (PiRpcEvent rpcEvent in activeEvents.Reader.ReadAllAsync(cancellationToken))
        {
            yield return rpcEvent;
        }
    }

    public async Task AbortAsync(CancellationToken cancellationToken)
    {
        if (!IsRunning)
        {
            return;
        }

        _ = await SendAsync(
            "abort",
            arguments: null,
            timeout: TimeSpan.FromSeconds(10),
            cancellationToken).ConfigureAwait(false);
    }

    public Task StopAsync(string reason, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        return StopCoreAsync(reason, cancellationToken);
    }

    private async Task StopCoreAsync(string reason, CancellationToken cancellationToken)
    {
        await lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (process is null)
            {
                return;
            }

            cancellationToken.ThrowIfCancellationRequested();
            Volatile.Write(ref stopStarted, 1);
            IPiRpcProcess activeProcess = process;
            outbound?.Writer.TryComplete();
            lifetimeCancellation?.Cancel();

            try
            {
                using CancellationTokenSource graceful = new(TimeSpan.FromSeconds(2));
                try
                {
                    await activeProcess.StandardInput.FlushAsync(graceful.Token).ConfigureAwait(false);
                    activeProcess.StandardInput.Close();
                    _ = await activeProcess.WaitForExitAsync(graceful.Token).ConfigureAwait(false);
                }
                catch (Exception exception) when (exception is OperationCanceledException
                    or IOException
                    or ObjectDisposedException
                    or InvalidOperationException)
                {
                    if (!activeProcess.HasExited)
                    {
                        await activeProcess.TerminateTreeAsync(CancellationToken.None).ConfigureAwait(false);
                    }
                }
            }
            finally
            {
                FailPending(new OperationCanceledException($"Pi RPC transport stopped: {reason}"));
                events?.Writer.TryComplete();
                await ObserveBackgroundTasksAsync().ConfigureAwait(false);
                await activeProcess.DisposeAsync().ConfigureAwait(false);
            }
        }
        finally
        {
            lifetimeCancellation?.Dispose();
            lifetimeCancellation = null;
            process = null;
            outbound = null;
            events = null;
            writerTask = null;
            readerTask = null;
            stderrTask = null;
            exitTask = null;
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
            await StopCoreAsync("dispose", CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            stderrBuffer.Dispose();
        }
    }

    public string GetRedactedStderrSnapshot()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        lock (stderrGate)
        {
            return System.Text.Encoding.UTF8.GetString(stderrBuffer.ToArray());
        }
    }

    private static byte[] SerializeCommand(
        string id,
        string command,
        IReadOnlyDictionary<string, object?>? arguments)
    {
        Dictionary<string, object?> payload = new(StringComparer.Ordinal)
        {
            ["id"] = id,
            ["type"] = command,
        };

        if (arguments is not null)
        {
            foreach ((string key, object? value) in arguments)
            {
                if (key is not ("id" or "type"))
                {
                    payload[key] = value;
                }
            }
        }

        return JsonSerializer.SerializeToUtf8Bytes(payload);
    }

    private static async Task RunWriterAsync(
        IPiRpcProcess activeProcess,
        ChannelReader<OutboundMessage> reader,
        CancellationToken cancellationToken)
    {
        await foreach (OutboundMessage message in reader.ReadAllAsync(cancellationToken))
        {
            await activeProcess.StandardInput
                .WriteAsync(message.Json, cancellationToken)
                .ConfigureAwait(false);
            await activeProcess.StandardInput
                .WriteAsync("\n"u8.ToArray(), cancellationToken)
                .ConfigureAwait(false);
            await activeProcess.StandardInput.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task RunReaderAsync(
        IPiRpcProcess activeProcess,
        ChannelWriter<PiRpcEvent> eventWriter,
        CancellationToken cancellationToken)
    {
        try
        {
            await foreach (ReadOnlyMemory<byte> frame in LfJsonlFrameReader.ReadFramesAsync(
                activeProcess.StandardOutput,
                cancellationToken: cancellationToken))
            {
                await ProcessFrameAsync(frame, eventWriter, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            FailPending(exception);
            eventWriter.TryComplete(exception);
            return;
        }

        eventWriter.TryComplete();
    }

    private async Task ProcessFrameAsync(
        ReadOnlyMemory<byte> frame,
        ChannelWriter<PiRpcEvent> eventWriter,
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
            throw new PiRpcProtocolException(
                "rpc.invalid_json",
                "Pi RPC stdout contained an invalid JSON frame.",
                exception);
        }

        if (!root.TryGetProperty("type", out JsonElement typeElement)
            || typeElement.ValueKind != JsonValueKind.String)
        {
            throw new PiRpcProtocolException(
                "rpc.missing_type",
                "Pi RPC frame did not contain a string type field.");
        }

        string type = typeElement.GetString()!;
        if (string.Equals(type, "response", StringComparison.Ordinal))
        {
            HandleResponse(root, eventWriter);
            return;
        }

        await eventWriter.WriteAsync(
            new PiRpcEvent(type, root, timeProvider.GetUtcNow()),
            cancellationToken).ConfigureAwait(false);
    }

    private void HandleResponse(JsonElement root, ChannelWriter<PiRpcEvent> eventWriter)
    {
        string? id = GetOptionalString(root, "id");
        string command = GetOptionalString(root, "command") ?? "unknown";
        bool success = root.TryGetProperty("success", out JsonElement successElement)
            && successElement.ValueKind is JsonValueKind.True;
        JsonElement? data = root.TryGetProperty("data", out JsonElement dataElement)
            ? dataElement.Clone()
            : null;
        string? error = GetError(root);

        if (id is not null && pending.TryRemove(id, out TaskCompletionSource<PiRpcResponse>? completion))
        {
            completion.TrySetResult(new PiRpcResponse(id, command, success, data, error));
            return;
        }

        JsonElement latePayload = JsonSerializer.SerializeToElement(
            new
            {
                responseId = id,
                command,
                success,
                reason = id is null ? "missing_id" : "late_or_unknown_id",
            });
        eventWriter.TryWrite(new PiRpcEvent(
            "protocol_unmatched_response",
            latePayload,
            timeProvider.GetUtcNow()));
    }

    private async Task CaptureStderrAsync(
        IPiRpcProcess activeProcess,
        CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[4096];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                int count = await activeProcess.StandardError
                    .ReadAsync(buffer, cancellationToken)
                    .ConfigureAwait(false);
                if (count == 0)
                {
                    return;
                }

                lock (stderrGate)
                {
                    int available = StderrLimitBytes - checked((int)stderrBuffer.Length);
                    if (available <= 0)
                    {
                        continue;
                    }

                    stderrBuffer.Write(buffer, 0, Math.Min(count, available));
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private async Task MonitorExitAsync(IPiRpcProcess activeProcess, CancellationToken cancellationToken)
    {
        int exitCode;
        try
        {
            exitCode = await activeProcess.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return;
        }

        PiRpcProtocolException exception = new(
            "rpc.process_exit",
            $"Pi RPC process exited with code {exitCode}.");
        FailPending(exception);
        events?.Writer.TryComplete(exception);
        outbound?.Writer.TryComplete(exception);
    }

    private void FailPending(Exception exception)
    {
        foreach ((string id, TaskCompletionSource<PiRpcResponse> completion) in pending)
        {
            if (pending.TryRemove(id, out _))
            {
                completion.TrySetException(exception);
            }
        }
    }

    private async Task ObserveBackgroundTasksAsync()
    {
        Task?[] candidates = [writerTask, readerTask, stderrTask, exitTask];
        Task[] tasks = candidates
            .Where(static task => task is not null)
            .Cast<Task>()
            .ToArray();
        if (tasks.Length == 0)
        {
            return;
        }

        try
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // The decisive error was already propagated through pending requests/events.
        }
    }

    private static string? GetOptionalString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out JsonElement property)
        && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static string? GetError(JsonElement root)
    {
        if (!root.TryGetProperty("error", out JsonElement errorElement))
        {
            return null;
        }

        return errorElement.ValueKind == JsonValueKind.String
            ? errorElement.GetString()
            : errorElement.GetRawText();
    }

    private sealed record OutboundMessage(ReadOnlyMemory<byte> Json);
}
