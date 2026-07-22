using CommunityToolkit.Mvvm.ComponentModel;

namespace Pi67.Desktop.Presentation.Shell;

public sealed class TranscriptItemViewModel : ObservableObject
{
    private string markdown;
    private bool isStreaming;

    public TranscriptItemViewModel(string author, string markdown, bool isStreaming)
    {
        Author = author;
        this.markdown = markdown;
        this.isStreaming = isStreaming;
        Timestamp = DateTimeOffset.Now;
    }

    public string Author { get; }

    public DateTimeOffset Timestamp { get; }

    public string Markdown
    {
        get => markdown;
        set => SetProperty(ref markdown, value);
    }

    public bool IsStreaming
    {
        get => isStreaming;
        set => SetProperty(ref isStreaming, value);
    }
}

public sealed class ToolActivityViewModel : ObservableObject
{
    private string status;
    private string detail;

    public ToolActivityViewModel(string id, string toolName, string detail, string status)
    {
        Id = id;
        ToolName = toolName;
        this.detail = detail;
        this.status = status;
    }

    public string Id { get; }

    public string ToolName { get; }

    public string Detail
    {
        get => detail;
        set => SetProperty(ref detail, value);
    }

    public string Status
    {
        get => status;
        set => SetProperty(ref status, value);
    }
}

public sealed record ComposerAttachmentViewModel(
    string Id,
    string FileName,
    string MimeType,
    string Base64Data,
    long DecodedBytes)
{
    public string DisplaySize => DecodedBytes switch
    {
        >= 1024 * 1024 => $"{DecodedBytes / (1024d * 1024d):0.0} MB",
        >= 1024 => $"{DecodedBytes / 1024d:0.0} KB",
        _ => $"{DecodedBytes} B",
    };
}

public sealed record SessionListItemViewModel(
    string DesktopThreadId,
    string DisplayName,
    string SessionPath,
    DateTimeOffset LastOpenedAt);

public sealed record ModelListItemViewModel(
    string Provider,
    string Id,
    string DisplayName,
    bool IsDefault)
{
    public string QualifiedId => $"{Provider}/{Id}";
}

public sealed record AuthListItemViewModel(
    string ProviderId,
    bool Configured,
    string Source,
    string? AccountLabel,
    bool SupportsApiKey,
    bool SupportsOAuth)
{
    public string StatusText => Source;
}
