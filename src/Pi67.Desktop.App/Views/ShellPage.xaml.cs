using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.Windows.ApplicationModel.Resources;
using Pi67.Desktop.Application.Bootstrap;
using Pi67.Desktop.Application.PiControl;
using Pi67.Desktop.Domain.Security;
using Pi67.Desktop.Presentation.Shell;
using Windows.Security.Cryptography;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.System;
using Windows.UI.Core;
using Pi67.Desktop.App.Controls;

namespace Pi67.Desktop.App.Views;

public sealed partial class ShellPage : Page, IDisposable
{
    private readonly SemaphoreSlim dialogGate = new(1, 1);
    private readonly ResourceLoader resources = new();
    private readonly CancellationTokenSource lifetime = new();
    private ShellViewModel? viewModel;
    private Window? hostWindow;
    private bool disposed;

    public ShellPage()
    {
        InitializeComponent();
    }

    public void Attach(ShellViewModel shellViewModel, Window window)
    {
        viewModel = shellViewModel ?? throw new ArgumentNullException(nameof(shellViewModel));
        hostWindow = window ?? throw new ArgumentNullException(nameof(window));
        DataContext = viewModel;
        viewModel.ExtensionUiRequested += OnExtensionUiRequested;
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        lifetime.Cancel();
        if (viewModel is not null) viewModel.ExtensionUiRequested -= OnExtensionUiRequested;
        viewModel = null;
        hostWindow = null;
    }

    private async void OnOpenWorkspaceClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is null || hostWindow is null) return;
            FolderPicker picker = new();
            picker.FileTypeFilter.Add("*");
            IntPtr windowHandle = WinRT.Interop.WindowNative.GetWindowHandle(hostWindow);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, windowHandle);
            StorageFolder? folder = await picker.PickSingleFolderAsync();
            if (folder is not null)
            {
                await viewModel.SelectWorkspaceAsync(folder.Path, cancellationToken);
            }
        });
    }

    private async void OnNewSessionClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null) await viewModel.CreateSessionAsync(cancellationToken);
        });
    }

    private async void OnOpenSessionClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null && SessionList.SelectedItem is SessionListItemViewModel session)
            {
                await viewModel.OpenSessionAsync(session, cancellationToken);
            }
        });
    }

    private async void OnOpenCompactSessionClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null && CompactSessionList.SelectedItem is SessionListItemViewModel session)
            {
                await viewModel.OpenSessionAsync(session, cancellationToken);
            }
        });
    }

    private void OnContextToggleClick(object sender, RoutedEventArgs args) =>
        ContextSplitView.IsPaneOpen = !ContextSplitView.IsPaneOpen;

    private async void OnExternalLinkRequested(object? sender, ExternalLinkRequestedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            ContentDialog dialog = new()
            {
                XamlRoot = XamlRoot,
                Title = Localize("Dialog.ExternalLinkTitle", "打开外部链接"),
                Content = new StackPanel
                {
                    Spacing = 8,
                    Children =
                    {
                        new TextBlock
                        {
                            Text = Localize(
                                "Dialog.ExternalLinkMessage",
                                "此操作会在默认浏览器中打开以下地址："),
                            TextWrapping = TextWrapping.Wrap,
                        },
                        new TextBlock
                        {
                            Text = args.Uri.AbsoluteUri,
                            IsTextSelectionEnabled = true,
                            TextWrapping = TextWrapping.Wrap,
                        },
                    },
                },
                PrimaryButtonText = Localize("Dialog.OpenLink", "允许本次打开"),
                CloseButtonText = Localize("Dialog.Cancel", "取消"),
                DefaultButton = ContentDialogButton.Close,
            };
            DialogOutcome outcome = await ShowDialogAsync(dialog, timeout: null, cancellationToken);
            if (outcome.Result is not ContentDialogResult.Primary) return;
            bool launched = await Launcher.LaunchUriAsync(args.Uri);
            if (!launched)
            {
                throw new InvalidOperationException("Windows could not open the selected external link.");
            }
        });
    }

    private async void OnSendClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null) await viewModel.SendAsync(cancellationToken);
        });
    }

    private async void OnStopClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null) await viewModel.StopAgentAsync(cancellationToken);
        });
    }

    private async void OnAttachImageClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is null || hostWindow is null) return;
            FileOpenPicker picker = new();
            picker.FileTypeFilter.Add(".png");
            picker.FileTypeFilter.Add(".jpg");
            picker.FileTypeFilter.Add(".jpeg");
            picker.FileTypeFilter.Add(".gif");
            picker.FileTypeFilter.Add(".webp");
            IntPtr windowHandle = WinRT.Interop.WindowNative.GetWindowHandle(hostWindow);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, windowHandle);
            StorageFile? file = await picker.PickSingleFileAsync();
            if (file is null) return;

            try
            {
                Windows.Storage.FileProperties.BasicProperties properties = await file.GetBasicPropertiesAsync();
                if (properties.Size is 0 or > 10 * 1024 * 1024)
                {
                    await ShowMessageAsync(
                        Localize("Dialog.ImageErrorTitle", "无法添加图片"),
                        Localize("Dialog.ImageSizeError", "每张图片必须在 1 字节到 10 MB 之间。"));
                    return;
                }
                cancellationToken.ThrowIfCancellationRequested();
                Windows.Storage.Streams.IBuffer buffer = await FileIO.ReadBufferAsync(file);
                viewModel.AddImageAttachment(
                    file.Name,
                    GetImageMimeType(file.FileType),
                    CryptographicBuffer.EncodeToBase64String(buffer));
            }
            catch (Exception exception) when (exception is IOException or InvalidOperationException or ArgumentException)
            {
                await ShowMessageAsync(Localize("Dialog.ImageErrorTitle", "无法添加图片"), exception.Message);
            }
        });
    }

    private void OnRemoveAttachmentClick(object sender, RoutedEventArgs args)
    {
        if (viewModel is not null && sender is Button { Tag: string attachmentId })
        {
            viewModel.RemoveImageAttachment(attachmentId);
        }
    }

    private async void OnComposerKeyDown(object sender, KeyRoutedEventArgs args)
    {
        CoreVirtualKeyStates shift = InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift);
        bool shiftDown = (shift & CoreVirtualKeyStates.Down) is CoreVirtualKeyStates.Down;
        if (args.Key is VirtualKey.Enter && !shiftDown && viewModel is not null)
        {
            args.Handled = true;
            await RunUiOperationAsync(viewModel.SendAsync);
        }
    }

    private async void OnTrustOnceClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null)
            {
                await viewModel.SetProjectTrustAsync(ProjectTrustDecision.TrustOnce, cancellationToken);
            }
        });
    }

    private async void OnTrustPersistClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null)
            {
                await viewModel.SetProjectTrustAsync(ProjectTrustDecision.TrustAndPersist, cancellationToken);
            }
        });
    }

    private async void OnDenyTrustClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null)
            {
                await viewModel.SetProjectTrustAsync(ProjectTrustDecision.Deny, cancellationToken);
            }
        });
    }

    private async void OnBootstrapStepClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is null || sender is not Button { Tag: BootstrapStep step }) return;
            if (step.Status is BootstrapStepStatus.Failed && step.FailureCode == "bootstrap.agent_directory_requires_review")
            {
                await ShowMessageAsync(
                    Localize("Dialog.ManualReviewTitle", "需要人工检查"),
                    step.FailureMessage ?? step.Description);
                return;
            }

            ContentDialog dialog = new()
            {
                XamlRoot = XamlRoot,
                Title = step.DisplayName,
                Content = new StackPanel
                {
                    Spacing = 8,
                    Children =
                    {
                        new TextBlock { Text = step.Description, TextWrapping = TextWrapping.Wrap },
                        new TextBlock
                        {
                            Text = string.Format(
                                System.Globalization.CultureInfo.CurrentCulture,
                                Localize("Dialog.Source", "来源：{0}"),
                                step.Source),
                            TextWrapping = TextWrapping.Wrap,
                        },
                        new TextBlock
                        {
                            Text = step.ExactCommand ?? Localize(
                                "Dialog.GeneratedCommand",
                                "命令将在执行时由内置引导器生成。"),
                            FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Cascadia Mono, Consolas"),
                            TextWrapping = TextWrapping.Wrap,
                            IsTextSelectionEnabled = true,
                        },
                    },
                },
                PrimaryButtonText = Localize("Dialog.ConfirmStep", "确认并执行这一步"),
                CloseButtonText = Localize("Dialog.Cancel", "取消"),
                DefaultButton = ContentDialogButton.Close,
            };
            DialogOutcome outcome = await ShowDialogAsync(dialog, timeout: null, cancellationToken);
            if (outcome.Result is ContentDialogResult.Primary)
            {
                await viewModel.ExecuteBootstrapStepAsync(step.Id, confirmed: true, cancellationToken);
            }
        });
    }

    private async void OnCancelBootstrapClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null) await viewModel.CancelBootstrapAsync(cancellationToken);
        });
    }

    private async void OnSetApiKeyClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is null || sender is not Button { Tag: AuthListItemViewModel provider }) return;
            PasswordBox password = new()
            {
                PlaceholderText = $"{provider.ProviderId} API key",
                PasswordRevealMode = PasswordRevealMode.Peek,
            };
            ContentDialog dialog = new()
            {
                XamlRoot = XamlRoot,
                Title = string.Format(
                    System.Globalization.CultureInfo.CurrentCulture,
                    Localize("Dialog.ApiKeyTitle", "设置 {0} API key"),
                    provider.ProviderId),
                Content = password,
                PrimaryButtonText = Localize("Dialog.Save", "保存"),
                CloseButtonText = Localize("Dialog.Cancel", "取消"),
                DefaultButton = ContentDialogButton.Close,
            };
            try
            {
                DialogOutcome outcome = await ShowDialogAsync(dialog, timeout: null, cancellationToken);
                if (outcome.Result is ContentDialogResult.Primary && !string.IsNullOrEmpty(password.Password))
                {
                    string apiKey = password.Password;
                    password.Password = string.Empty;
                    await viewModel.SetApiKeyAsync(provider.ProviderId, apiKey, cancellationToken);
                }
            }
            finally
            {
                password.Password = string.Empty;
            }
        });
    }

    private async void OnOAuthClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is null || sender is not Button { Tag: AuthListItemViewModel provider }) return;
            try
            {
                await viewModel.RunOAuthAsync(provider.ProviderId, HandleOAuthInteractionAsync, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception) when (exception is IOException or InvalidOperationException)
            {
                await ShowMessageAsync(Localize("Dialog.OAuthFailedTitle", "OAuth 登录未完成"), exception.Message);
            }
        });
    }

    private async void OnLogoutClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null && sender is Button { Tag: AuthListItemViewModel provider })
            {
                await viewModel.LogoutAsync(provider.ProviderId, cancellationToken);
            }
        });
    }

    private async void OnSetDefaultModelClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null && sender is Button { Tag: ModelListItemViewModel model })
            {
                await viewModel.UpdateDefaultModelAsync(model, cancellationToken);
            }
        });
    }

    private async void OnRefreshModelsClick(object sender, RoutedEventArgs args)
    {
        await RunUiOperationAsync(async cancellationToken =>
        {
            if (viewModel is not null) await viewModel.RefreshModelsAsync(cancellationToken);
        });
    }

    private async void OnExtensionUiRequested(object? sender, ExtensionUiRequestEventArgs args)
    {
        await RunUiOperationAsync(cancellationToken =>
            HandleExtensionUiRequestAsync(args.Request, cancellationToken));
    }

    private async Task HandleExtensionUiRequestAsync(
        ExtensionUiRequest request,
        CancellationToken cancellationToken)
    {
        if (viewModel is null) return;
        ContentDialog dialog = new()
        {
            XamlRoot = XamlRoot,
            Title = request.Title,
            CloseButtonText = Localize("Dialog.Deny", "拒绝"),
            DefaultButton = ContentDialogButton.Close,
        };
        IReadOnlyDictionary<string, object?> response;
        try
        {
            if (request.Method == "confirm")
            {
                dialog.Content = new TextBlock { Text = request.Message, TextWrapping = TextWrapping.Wrap };
                dialog.PrimaryButtonText = Localize("Dialog.AllowOnce", "允许本次命令");
                DialogOutcome outcome = await ShowDialogAsync(dialog, request.Timeout, cancellationToken);
                response = outcome.TimedOut
                    ? new Dictionary<string, object?> { ["confirmed"] = false, ["cancelled"] = true, ["reason"] = "timeout" }
                    : new Dictionary<string, object?> { ["confirmed"] = outcome.Result is ContentDialogResult.Primary };
            }
            else if (request.Method == "select")
            {
                ComboBox choices = new()
                {
                    ItemsSource = request.Options,
                    SelectedIndex = request.Options.Count > 0 ? 0 : -1,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                };
                dialog.Content = choices;
                dialog.PrimaryButtonText = Localize("Dialog.Select", "选择");
                DialogOutcome outcome = await ShowDialogAsync(dialog, request.Timeout, cancellationToken);
                response = outcome.Result is ContentDialogResult.Primary && !outcome.TimedOut
                    ? new Dictionary<string, object?> { ["value"] = choices.SelectedItem }
                    : new Dictionary<string, object?> { ["cancelled"] = true, ["reason"] = outcome.TimedOut ? "timeout" : "user" };
            }
            else if (request.Method is "input" or "editor")
            {
                TextBox input = new()
                {
                    Text = request.Prefill ?? string.Empty,
                    PlaceholderText = request.Placeholder,
                    AcceptsReturn = request.Method == "editor",
                    MinWidth = 420,
                    MinHeight = request.Method == "editor" ? 180 : 0,
                    TextWrapping = TextWrapping.Wrap,
                };
                dialog.Content = input;
                dialog.PrimaryButtonText = Localize("Dialog.Submit", "提交");
                DialogOutcome outcome = await ShowDialogAsync(dialog, request.Timeout, cancellationToken);
                response = outcome.Result is ContentDialogResult.Primary && !outcome.TimedOut
                    ? new Dictionary<string, object?> { ["value"] = input.Text }
                    : new Dictionary<string, object?> { ["cancelled"] = true, ["reason"] = outcome.TimedOut ? "timeout" : "user" };
            }
            else
            {
                response = new Dictionary<string, object?>
                {
                    ["cancelled"] = true,
                    ["reason"] = "unsupported_method",
                };
            }
        }
        catch (OperationCanceledException)
        {
            response = new Dictionary<string, object?> { ["cancelled"] = true, ["reason"] = "timeout" };
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Pi-67 Desktop extension UI failed closed: {exception}");
            response = new Dictionary<string, object?> { ["cancelled"] = true, ["reason"] = "ui_error" };
        }

        await viewModel.RespondToExtensionUiAsync(request.Id, response, cancellationToken);
        if (!disposed) Composer.Focus(FocusState.Programmatic);
    }

    private async Task<string?> HandleOAuthInteractionAsync(
        OAuthProgress progress,
        CancellationToken cancellationToken)
    {
        if (progress.AuthorizationUri is not null)
        {
            bool launched = await Launcher.LaunchUriAsync(progress.AuthorizationUri);
            if (!launched) throw new InvalidOperationException("Windows could not open the OAuth authorization URL.");
        }
        if (progress.InteractionId is null) return string.Empty;

        Control interaction;
        ComboBox? choices = null;
        TextBox? input = null;
        if (progress.Choices.Count > 0)
        {
            choices = new ComboBox
            {
                ItemsSource = progress.Choices,
                DisplayMemberPath = nameof(OAuthChoice.Label),
                SelectedValuePath = nameof(OAuthChoice.Id),
                SelectedIndex = 0,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            interaction = choices;
        }
        else
        {
            input = new TextBox { PlaceholderText = progress.Placeholder };
            interaction = input;
        }

        ContentDialog dialog = new()
        {
            XamlRoot = XamlRoot,
            Title = Localize("Dialog.OAuthTitle", "OAuth 登录"),
            Content = new StackPanel
            {
                Spacing = 8,
                Children =
                {
                    new TextBlock { Text = progress.Message, TextWrapping = TextWrapping.Wrap },
                    interaction,
                },
            },
            PrimaryButtonText = Localize("Dialog.Continue", "继续"),
            CloseButtonText = Localize("Dialog.Cancel", "取消"),
            DefaultButton = ContentDialogButton.Close,
        };
        if (input is not null && !progress.AllowEmpty)
        {
            dialog.IsPrimaryButtonEnabled = false;
            input.TextChanged += (_, _) =>
                dialog.IsPrimaryButtonEnabled = !string.IsNullOrWhiteSpace(input.Text);
        }
        DialogOutcome outcome = await ShowDialogAsync(dialog, timeout: null, cancellationToken);
        if (outcome.Result is not ContentDialogResult.Primary) return null;
        return choices is null ? input!.Text : choices.SelectedValue?.ToString();
    }

    private async Task ShowMessageAsync(string title, string message)
    {
        ContentDialog dialog = new()
        {
            XamlRoot = XamlRoot,
            Title = title,
            Content = new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap },
            CloseButtonText = Localize("Dialog.Close", "关闭"),
            DefaultButton = ContentDialogButton.Close,
        };
        _ = await ShowDialogAsync(dialog, timeout: null, CancellationToken.None);
    }

    private async Task<DialogOutcome> ShowDialogAsync(
        ContentDialog dialog,
        TimeSpan? timeout,
        CancellationToken cancellationToken)
    {
        using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(
            lifetime.Token,
            cancellationToken);
        if (timeout is { } value && value > TimeSpan.Zero) deadline.CancelAfter(value);
        await dialogGate.WaitAsync(deadline.Token);
        try
        {
            deadline.Token.ThrowIfCancellationRequested();
            int timedOut = 0;
            using CancellationTokenRegistration registration = deadline.Token.Register(() =>
            {
                Interlocked.Exchange(ref timedOut, 1);
                _ = DispatcherQueue.TryEnqueue(dialog.Hide);
            });
            ContentDialogResult result = await dialog.ShowAsync();
            if (cancellationToken.IsCancellationRequested) cancellationToken.ThrowIfCancellationRequested();
            return new DialogOutcome(result, Volatile.Read(ref timedOut) != 0);
        }
        finally
        {
            dialogGate.Release();
            if (!disposed) Composer.Focus(FocusState.Programmatic);
        }
    }

    private static string GetImageMimeType(string extension) => extension.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        _ => throw new ArgumentException("Unsupported image type.", nameof(extension)),
    };

    private string Localize(string key, string fallback)
    {
        try
        {
            string value = resources.GetString(key);
            return string.IsNullOrWhiteSpace(value) ? fallback : value;
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            return fallback;
        }
    }

    private async Task RunUiOperationAsync(Func<CancellationToken, Task> operation)
    {
        if (disposed) return;
        try
        {
            await operation(lifetime.Token);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Pi-67 Desktop UI operation failed: {exception}");
            if (disposed) return;
            viewModel?.ReportUnexpectedUiFailure();
            try
            {
                await ShowMessageAsync(
                    Localize("Dialog.OperationFailedTitle", "操作未完成"),
                    Localize(
                        "Dialog.OperationFailedMessage",
                        "当前状态已保留。请检查 Pi 运行状态后重试。"));
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
            {
            }
        }
    }

    private sealed record DialogOutcome(ContentDialogResult Result, bool TimedOut);
}
