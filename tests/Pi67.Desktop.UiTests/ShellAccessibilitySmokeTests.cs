using FlaUI.Core;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Tools;
using FlaUI.UIA3;

namespace Pi67.Desktop.UiTests;

public sealed class ShellAccessibilitySmokeTests
{
    [Fact]
    public void PublishedAppExposesCoreShellThroughWindowsUiAutomation()
    {
        if (Environment.GetEnvironmentVariable("PI67_RUN_UI_TESTS") != "1")
        {
            Assert.Skip("Set PI67_RUN_UI_TESTS=1 on a controlled interactive Windows runner.");
        }

        string executable = Environment.GetEnvironmentVariable("PI67_DESKTOP_UI_EXE")
            ?? throw new InvalidOperationException("PI67_DESKTOP_UI_EXE must identify the published app executable.");
        Assert.True(File.Exists(executable), $"Published app was not found: {executable}");

        using Application application = Application.Launch(executable);
        using UIA3Automation automation = new();
        try
        {
            Window? candidate = Retry.WhileNull(
                () => application.GetMainWindow(automation, TimeSpan.FromSeconds(2)),
                timeout: TimeSpan.FromSeconds(15),
                interval: TimeSpan.FromMilliseconds(250),
                throwOnTimeout: true).Result;
            Window window = Assert.IsType<Window>(candidate);

            Assert.Equal("Pi-67 Desktop", window.Title);
            Assert.NotNull(FindByAutomationId(window, "OpenWorkspaceButton"));
            Assert.NotNull(FindByAutomationId(window, "NewSessionButton"));
            Assert.NotNull(FindByAutomationId(window, "Composer"));
            Assert.NotNull(FindByAutomationId(window, "SendButton"));
            Assert.NotNull(FindByAutomationId(window, "OperationStatusText"));
        }
        finally
        {
            if (!application.HasExited)
            {
                application.CloseTimeout = TimeSpan.FromSeconds(5);
                application.Close(killIfCloseFails: true);
            }
        }
    }

    private static AutomationElement? FindByAutomationId(Window window, string automationId) =>
        window.FindFirstDescendant(condition => condition.ByAutomationId(automationId));
}
