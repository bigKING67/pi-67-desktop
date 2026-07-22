using Microsoft.UI.Xaml;
using Pi67.Desktop.Presentation.Shell;

namespace Pi67.Desktop.App;

public sealed partial class MainWindow : Window, IDisposable
{
    private readonly ShellViewModel viewModel;
    private readonly CancellationTokenSource lifetime = new();
    private bool initialized;
    private bool shutdownStarted;
    private bool shutdownCompleted;

    public MainWindow(ShellViewModel viewModel)
    {
        this.viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
        Title = "Pi-67 Desktop";
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        Shell.Attach(viewModel, this);
        AppTitleBar.DataContext = viewModel;
        viewModel.TitleRequested += OnTitleRequested;
        Activated += OnActivated;
        AppWindow.Closing += OnAppWindowClosing;
        Closed += OnClosed;
    }

    private async void OnActivated(object sender, WindowActivatedEventArgs args)
    {
        if (initialized) return;
        initialized = true;
        try
        {
            await viewModel.InitializeAsync(lifetime.Token);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            System.Diagnostics.Trace.TraceError($"Pi-67 Desktop initialization failed: {exception}");
            viewModel.ReportUnexpectedUiFailure();
        }
    }

    private void OnTitleRequested(object? sender, TitleRequestedEventArgs args) => Title = args.Title;

    private async void OnAppWindowClosing(
        Microsoft.UI.Windowing.AppWindow sender,
        Microsoft.UI.Windowing.AppWindowClosingEventArgs args)
    {
        if (shutdownCompleted) return;
        args.Cancel = true;
        if (shutdownStarted) return;
        shutdownStarted = true;
        viewModel.ReportShutdownStarting();
        lifetime.Cancel();
        Shell.Dispose();
        try
        {
            Task shutdown = viewModel.DisposeAsync().AsTask();
            Task completed = await Task.WhenAny(shutdown, Task.Delay(TimeSpan.FromSeconds(5)));
            if (completed == shutdown) await shutdown;
            else _ = ObserveShutdownFailureAsync(shutdown);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Trace.TraceError($"Pi-67 Desktop shutdown failed: {exception}");
        }
        finally
        {
            shutdownCompleted = true;
            Close();
        }
    }

    private void OnClosed(object sender, WindowEventArgs args)
    {
        Dispose();
    }

    public void Dispose()
    {
        lifetime.Cancel();
        AppWindow.Closing -= OnAppWindowClosing;
        viewModel.TitleRequested -= OnTitleRequested;
        Activated -= OnActivated;
        Closed -= OnClosed;
        Shell.Dispose();
    }

    private static async Task ObserveShutdownFailureAsync(Task shutdown)
    {
        try
        {
            await shutdown;
        }
        catch (Exception exception)
        {
            System.Diagnostics.Trace.TraceError($"Pi-67 Desktop delayed shutdown failed: {exception}");
        }
    }
}
