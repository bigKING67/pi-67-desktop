using Pi67.Desktop.Infrastructure.Windows.PiControl;

namespace Pi67.Desktop.Infrastructure.Windows.Tests.PiControl;

public sealed class NodePiControlBridgeLifecycleTests
{
    [Fact]
    public async Task DisposeIsSharedAndRejectsLaterStartup()
    {
        NodePiControlBridge bridge = new(new PiControlBridgeOptions(
            "missing-node.exe",
            "missing-bridge.mjs",
            "missing-pi-package",
            "missing-agent-directory",
            "missing-workspace"));

        Task first = bridge.DisposeAsync().AsTask();
        Task second = bridge.DisposeAsync().AsTask();
        await Task.WhenAll(first, second);

        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            bridge.GetAuthStatusAsync(TestContext.Current.CancellationToken));
    }
}
