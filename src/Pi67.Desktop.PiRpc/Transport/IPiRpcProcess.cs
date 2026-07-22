using Pi67.Desktop.Application.Runtime;

namespace Pi67.Desktop.PiRpc.Transport;

public interface IPiRpcProcess : IAsyncDisposable
{
    Stream StandardInput { get; }

    Stream StandardOutput { get; }

    Stream StandardError { get; }

    bool HasExited { get; }

    int? ExitCode { get; }

    Task<int> WaitForExitAsync(CancellationToken cancellationToken);

    Task TerminateTreeAsync(CancellationToken cancellationToken);
}

public interface IPiRpcProcessFactory
{
    Task<IPiRpcProcess> StartAsync(
        PiRuntimeLaunchPlan launchPlan,
        CancellationToken cancellationToken);
}
