using System.Text.Json;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Sessions;

namespace Pi67.Desktop.Application.Sessions;

public sealed record PiSessionState(
    string? SessionFile,
    string? SessionId,
    string? SessionName,
    bool IsStreaming,
    bool IsCompacting,
    string ThinkingLevel,
    string? Provider,
    string? Model,
    int MessageCount,
    int PendingMessageCount,
    JsonElement RawState);

public interface IPiSessionSupervisor : IAsyncDisposable
{
    PiSessionReference? CurrentSession { get; }

    Task<PiSessionState> CreateSessionAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        CancellationToken cancellationToken);

    Task<PiSessionState> OpenSessionAsync(
        PiRuntimeDescriptor runtime,
        PiSessionLaunchOptions options,
        string sessionPath,
        CancellationToken cancellationToken);

    Task<PiRpcResponse> SendPromptAsync(
        string message,
        IReadOnlyList<PiImageInput>? images,
        CancellationToken cancellationToken);

    Task<PiRpcResponse> SteerAsync(string message, CancellationToken cancellationToken);

    Task<PiRpcResponse> FollowUpAsync(string message, CancellationToken cancellationToken);

    Task AbortAsync(CancellationToken cancellationToken);

    Task<PiRpcResponse> CompactAsync(CancellationToken cancellationToken);

    Task<PiRpcResponse> AbortRetryAsync(CancellationToken cancellationToken);

    Task RespondToExtensionUiAsync(
        string requestId,
        IReadOnlyDictionary<string, object?> response,
        CancellationToken cancellationToken);

    Task<JsonElement> GetEntriesAsync(string? sinceEntryId, CancellationToken cancellationToken);

    Task<JsonElement> GetTreeAsync(CancellationToken cancellationToken);

    IAsyncEnumerable<PiRpcEvent> ReadEventsAsync(CancellationToken cancellationToken);

    Task CloseSessionAsync(CancellationToken cancellationToken);
}

public sealed record PiImageInput(string MimeType, string Base64Data);

public interface ISessionProjectionStore
{
    Task InitializeAsync(CancellationToken cancellationToken);

    Task UpsertSessionAsync(PiSessionReference session, CancellationToken cancellationToken);

    Task<IReadOnlyList<PiSessionReference>> ListSessionsAsync(
        string? workspacePath,
        int offset,
        int limit,
        CancellationToken cancellationToken);

    Task DeleteProjectionAsync(string desktopThreadId, CancellationToken cancellationToken);
}
