namespace Pi67.Desktop.Presentation.Shell;

public sealed record ExtensionUiRequest(
    string Id,
    string Method,
    string Title,
    string? Message,
    string? Placeholder,
    string? Prefill,
    IReadOnlyList<string> Options,
    TimeSpan? Timeout);

public sealed class ExtensionUiRequestEventArgs(ExtensionUiRequest request) : EventArgs
{
    public ExtensionUiRequest Request { get; } = request;
}

public sealed class TitleRequestedEventArgs(string title) : EventArgs
{
    public string Title { get; } = title;
}
