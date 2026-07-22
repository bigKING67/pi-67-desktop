using System.Text.Json;

namespace Pi67.Desktop.Application.Runtime;

public sealed record PiRpcEvent(
    string Type,
    JsonElement Payload,
    DateTimeOffset ReceivedAt);

public sealed record PiRpcResponse(
    string Id,
    string Command,
    bool Success,
    JsonElement? Data,
    string? Error);

public interface IPiRpcTransport : IAsyncDisposable
{
    bool IsRunning { get; }

    Task StartAsync(PiRuntimeLaunchPlan launchPlan, CancellationToken cancellationToken);

    Task<PiRpcResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        TimeSpan timeout,
        CancellationToken cancellationToken);

    Task RespondToUiAsync(
        string requestId,
        object? result,
        CancellationToken cancellationToken);

    IAsyncEnumerable<PiRpcEvent> ReadEventsAsync(CancellationToken cancellationToken);

    Task AbortAsync(CancellationToken cancellationToken);

    Task StopAsync(string reason, CancellationToken cancellationToken);
}
