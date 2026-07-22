using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using FontWeight = Windows.UI.Text.FontWeight;
using MarkdownBlock = Markdig.Syntax.Block;
using MarkdownInline = Markdig.Syntax.Inlines.Inline;
using XamlApplication = Microsoft.UI.Xaml.Application;

namespace Pi67.Desktop.App.Controls;

public sealed class NativeMarkdownView : ContentControl
{
    public event EventHandler<ExternalLinkRequestedEventArgs>? ExternalLinkRequested;

    public static readonly DependencyProperty MarkdownProperty = DependencyProperty.Register(
        nameof(Markdown),
        typeof(string),
        typeof(NativeMarkdownView),
        new PropertyMetadata(string.Empty, OnContentChanged));

    public static readonly DependencyProperty IsStreamingProperty = DependencyProperty.Register(
        nameof(IsStreaming),
        typeof(bool),
        typeof(NativeMarkdownView),
        new PropertyMetadata(false, OnContentChanged));

    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseEmphasisExtras()
        .UseAutoLinks()
        .Build();

    public string Markdown
    {
        get => (string)GetValue(MarkdownProperty);
        set => SetValue(MarkdownProperty, value);
    }

    public bool IsStreaming
    {
        get => (bool)GetValue(IsStreamingProperty);
        set => SetValue(IsStreamingProperty, value);
    }

    private static void OnContentChanged(DependencyObject sender, DependencyPropertyChangedEventArgs args) =>
        ((NativeMarkdownView)sender).Render();

    private void Render()
    {
        if (IsStreaming)
        {
            Content = CreateTextBlock(Markdown, 14, FontWeights.Normal);
            return;
        }

        StackPanel root = new() { Spacing = 10 };
        MarkdownDocument document = Markdig.Markdown.Parse(Markdown ?? string.Empty, Pipeline);
        foreach (MarkdownBlock block in document)
        {
            root.Children.Add(RenderBlock(block));
        }
        Content = root;
    }

    private FrameworkElement RenderBlock(MarkdownBlock block) => block switch
    {
        HeadingBlock heading => RenderParagraph(heading.Inline, 22 - ((heading.Level - 1) * 2), FontWeights.SemiBold),
        ParagraphBlock paragraph => RenderParagraph(paragraph.Inline, 14, FontWeights.Normal),
        FencedCodeBlock code => RenderCode(code.Lines.ToString()),
        CodeBlock code => RenderCode(code.Lines.ToString()),
        QuoteBlock quote => RenderContainer(quote, quoted: true),
        ListBlock list => RenderList(list),
        ThematicBreakBlock => new Border
        {
            Height = 1,
            Margin = new Thickness(0, 8, 0, 8),
            Background = (Brush)XamlApplication.Current.Resources["Pi67DividerBrush"],
        },
        HtmlBlock html => RenderCode(html.Lines.ToString()),
        ContainerBlock container => RenderContainer(container, quoted: false),
        LeafBlock leaf => CreateTextBlock(leaf.Lines.ToString(), 14, FontWeights.Normal),
        _ => CreateTextBlock(block.ToString() ?? string.Empty, 14, FontWeights.Normal),
    };

    private TextBlock RenderParagraph(ContainerInline? inline, double size, FontWeight weight)
    {
        TextBlock text = CreateTextBlock(string.Empty, size, weight);
        if (inline is not null) AppendInlines(text.Inlines, inline);
        return text;
    }

    private static Border RenderCode(string code) => new()
    {
        Padding = new Thickness(12),
        Background = (Brush)XamlApplication.Current.Resources["Pi67CodeBrush"],
        BorderBrush = (Brush)XamlApplication.Current.Resources["Pi67DividerBrush"],
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(4),
        Child = new TextBlock
        {
            Text = code,
            FontFamily = new FontFamily("Cascadia Mono, Consolas"),
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        },
    };

    private FrameworkElement RenderContainer(ContainerBlock container, bool quoted)
    {
        StackPanel panel = new() { Spacing = 8 };
        foreach (MarkdownBlock child in container) panel.Children.Add(RenderBlock(child));
        if (!quoted) return panel;
        return new Border
        {
            BorderBrush = (Brush)XamlApplication.Current.Resources["AccentFillColorDefaultBrush"],
            BorderThickness = new Thickness(3, 0, 0, 0),
            Padding = new Thickness(12, 0, 0, 0),
            Child = panel,
        };
    }

    private StackPanel RenderList(ListBlock list)
    {
        StackPanel panel = new() { Spacing = 6 };
        int index = int.TryParse(list.OrderedStart, out int orderedStart) ? orderedStart : 1;
        foreach (ListItemBlock item in list)
        {
            StackPanel row = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(CreateTextBlock(list.IsOrdered ? $"{index++}." : "•", 14, FontWeights.SemiBold));
            row.Children.Add(RenderContainer(item, quoted: false));
            panel.Children.Add(row);
        }
        return panel;
    }

    private static TextBlock CreateTextBlock(string text, double size, FontWeight weight) => new()
    {
        Text = text,
        FontSize = size,
        FontWeight = weight,
        TextWrapping = TextWrapping.Wrap,
        IsTextSelectionEnabled = true,
    };

    private void AppendInlines(InlineCollection destination, ContainerInline container)
    {
        for (MarkdownInline? inline = container.FirstChild; inline is not null; inline = inline.NextSibling)
        {
            switch (inline)
            {
                case LiteralInline literal:
                    destination.Add(new Run { Text = literal.Content.ToString() });
                    break;
                case CodeInline code:
                    destination.Add(new Run
                    {
                        Text = code.Content,
                        FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                    });
                    break;
                case LineBreakInline:
                    destination.Add(new LineBreak());
                    break;
                case EmphasisInline emphasis:
                    Span span = new()
                    {
                        FontStyle = emphasis.DelimiterCount == 1 ? Windows.UI.Text.FontStyle.Italic : Windows.UI.Text.FontStyle.Normal,
                        FontWeight = emphasis.DelimiterCount >= 2 ? FontWeights.SemiBold : FontWeights.Normal,
                    };
                    AppendInlines(span.Inlines, emphasis);
                    destination.Add(span);
                    break;
                case LinkInline link when !link.IsImage:
                    if (Uri.TryCreate(link.Url, UriKind.Absolute, out Uri? uri)
                        && uri.Scheme is "https" or "http")
                    {
                        Hyperlink hyperlink = new();
                        hyperlink.Click += (_, _) =>
                            ExternalLinkRequested?.Invoke(this, new ExternalLinkRequestedEventArgs(uri));
                        AppendInlines(hyperlink.Inlines, link);
                        destination.Add(hyperlink);
                    }
                    else
                    {
                        Span linkText = new();
                        AppendInlines(linkText.Inlines, link);
                        destination.Add(linkText);
                    }
                    break;
                case HtmlInline html:
                    destination.Add(new Run { Text = html.Tag });
                    break;
                case ContainerInline nested:
                    Span nestedSpan = new();
                    AppendInlines(nestedSpan.Inlines, nested);
                    destination.Add(nestedSpan);
                    break;
            }
        }
    }
}

public sealed class ExternalLinkRequestedEventArgs(Uri uri) : EventArgs
{
    public Uri Uri { get; } = uri ?? throw new ArgumentNullException(nameof(uri));
}
