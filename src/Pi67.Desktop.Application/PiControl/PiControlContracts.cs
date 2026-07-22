using System.Text.Json;
using Pi67.Desktop.Domain.Security;

namespace Pi67.Desktop.Application.PiControl;

public sealed record RedactedAuthStatus(
    string ProviderId,
    bool Configured,
    string Source,
    string? AccountLabel,
    bool SupportsApiKey,
    bool SupportsOAuth);

public sealed record PiModelSummary(
    string Provider,
    string Id,
    string DisplayName,
    IReadOnlyList<string> ThinkingLevels,
    bool SupportsImages,
    bool IsDefault);

public sealed record OAuthProgress(
    string FlowId,
    string? InteractionId,
    string Stage,
    string Message,
    Uri? AuthorizationUri,
    string? UserCode,
    string? Placeholder,
    bool AllowEmpty,
    IReadOnlyList<OAuthChoice> Choices);

public sealed record OAuthChoice(string Id, string Label);

public interface IPiControlBridge : IAsyncDisposable
{
    Task<IReadOnlyList<RedactedAuthStatus>> GetAuthStatusAsync(CancellationToken cancellationToken);

    Task SetApiKeyAsync(string providerId, string apiKey, CancellationToken cancellationToken);

    IAsyncEnumerable<OAuthProgress> BeginOAuthAsync(
        string providerId,
        CancellationToken cancellationToken);

    Task RespondToOAuthAsync(
        string flowId,
        string interactionId,
        string? value,
        CancellationToken cancellationToken);

    Task CancelOAuthAsync(string flowId, CancellationToken cancellationToken);

    Task LogoutAsync(string providerId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PiModelSummary>> ListModelsAsync(CancellationToken cancellationToken);

    Task RefreshModelsAsync(CancellationToken cancellationToken);

    Task<JsonElement> GetSettingsAsync(CancellationToken cancellationToken);

    Task UpdateDefaultsAsync(
        string providerId,
        string modelId,
        CancellationToken cancellationToken);

    Task<ProjectTrustStatus> InspectTrustAsync(
        string workspacePath,
        CancellationToken cancellationToken);

    Task<ProjectTrustStatus> SetTrustAsync(
        string workspacePath,
        ProjectTrustDecision decision,
        CancellationToken cancellationToken);
}

public interface IPiControlBridgeFactory
{
    IPiControlBridge Create(Pi67.Desktop.Application.Runtime.PiRuntimeDescriptor runtime, string workspacePath);
}
