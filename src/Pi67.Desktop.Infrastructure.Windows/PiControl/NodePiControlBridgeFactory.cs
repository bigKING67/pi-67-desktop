using Pi67.Desktop.Application.PiControl;
using Pi67.Desktop.Application.Runtime;

namespace Pi67.Desktop.Infrastructure.Windows.PiControl;

public sealed class NodePiControlBridgeFactory(
    string bridgeEntryPath,
    string defaultAgentDirectory) : IPiControlBridgeFactory
{
    public IPiControlBridge Create(PiRuntimeDescriptor runtime, string workspacePath)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        if (string.IsNullOrWhiteSpace(runtime.NodeExecutable)
            || string.IsNullOrWhiteSpace(runtime.PackageRoot))
        {
            throw new InvalidOperationException(
                "The installed Pi runtime does not expose the Node package required for settings and authentication.");
        }

        return new NodePiControlBridge(new PiControlBridgeOptions(
            runtime.NodeExecutable,
            Path.GetFullPath(bridgeEntryPath),
            Path.GetFullPath(runtime.PackageRoot),
            string.IsNullOrWhiteSpace(runtime.AgentDirectory)
                ? Path.GetFullPath(defaultAgentDirectory)
                : Path.GetFullPath(runtime.AgentDirectory),
            Path.GetFullPath(workspacePath)));
    }
}
