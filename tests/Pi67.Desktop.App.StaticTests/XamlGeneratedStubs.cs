using Microsoft.UI.Xaml.Controls;

namespace Pi67.Desktop.App.Views
{
    public sealed partial class ShellPage
    {
        private readonly ListView SessionList = new();
        private readonly ListView CompactSessionList = new();
        private readonly TextBox Composer = new();
        private readonly SplitView ContextSplitView = new();

        private void InitializeComponent()
        {
            _ = SessionList;
        }
    }
}

namespace Pi67.Desktop.App
{
    public sealed partial class MainWindow
    {
        private readonly Border AppTitleBar = new();
        private readonly Views.ShellPage Shell = new();

        private void InitializeComponent()
        {
            _ = AppTitleBar;
        }
    }
}
