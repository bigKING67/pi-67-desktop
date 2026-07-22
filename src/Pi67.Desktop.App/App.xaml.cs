using Microsoft.UI.Xaml;
using Pi67.Desktop.Infrastructure.Windows.Bootstrap;
using Pi67.Desktop.Infrastructure.Windows.PiControl;
using Pi67.Desktop.Infrastructure.Windows.Processes;
using Pi67.Desktop.Infrastructure.Windows.Runtime;
using Pi67.Desktop.Infrastructure.Windows.Storage;
using Pi67.Desktop.App.Services;
using Pi67.Desktop.PiRpc.Sessions;
using Pi67.Desktop.PiRpc.Transport;
using Pi67.Desktop.Presentation.Shell;

namespace Pi67.Desktop.App;

public partial class App : global::Microsoft.UI.Xaml.Application
{
    public App()
    {
        InitializeComponent();
    }

    public MainWindow? MainWindow { get; private set; }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        string localData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Pi-67 Desktop");
        string agentDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".pi",
            "agent");
        string baseDirectory = AppContext.BaseDirectory;
        WindowsPiRuntimeLocator runtimeLocator = new();
        SqliteSessionProjectionStore projectionStore = new(Path.Combine(localData, "projection", "sessions.db"));
        PiRpcTransport transport = new(new WindowsPiRpcProcessFactory());
        PiSessionSupervisor supervisor = new(runtimeLocator, transport, projectionStore);
        WindowsBootstrapCoordinator bootstrap = new(
            runtimeLocator,
            new WindowsCommandRunner(),
            agentDirectory);
        NodePiControlBridgeFactory bridgeFactory = new(
            Path.Combine(baseDirectory, "Bridge", "index.mjs"),
            agentDirectory);
        ShellViewModel viewModel = new(
            runtimeLocator,
            bootstrap,
            supervisor,
            projectionStore,
            bridgeFactory,
            Path.Combine(baseDirectory, "Extensions", "pi67-desktop-safety", "index.mjs"),
            SynchronizationContext.Current,
            new WinUiShellTextProvider());

        MainWindow = new MainWindow(viewModel);
        MainWindow.Activate();
    }
}
