using System.Diagnostics;
using System.Text;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.PiRpc.Transport;

namespace Pi67.Desktop.Infrastructure.Windows.Processes;

public sealed class WindowsPiRpcProcessFactory : IPiRpcProcessFactory
{
    public Task<IPiRpcProcess> StartAsync(
        PiRuntimeLaunchPlan launchPlan,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(launchPlan);
        cancellationToken.ThrowIfCancellationRequested();

        ProcessStartInfo startInfo = CreateStartInfo(launchPlan);
        Process process = new() { StartInfo = startInfo, EnableRaisingEvents = true };
        WindowsJobObject? job = null;

        try
        {
            if (!process.Start())
            {
                throw new InvalidOperationException("Windows did not start the Pi RPC process.");
            }

            job = WindowsJobObject.CreateKillOnClose();
            job.Assign(process.Handle);
            return Task.FromResult<IPiRpcProcess>(new WindowsPiRpcProcess(process, job));
        }
        catch
        {
            job?.Dispose();
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }

            process.Dispose();
            throw;
        }
    }

    private static ProcessStartInfo CreateStartInfo(PiRuntimeLaunchPlan launchPlan)
    {
        bool isCommandShim = launchPlan.Runtime.LauncherKind is PiRuntimeLauncherKind.CommandShim
            || Path.GetExtension(launchPlan.FileName) is ".cmd" or ".bat";
        ProcessStartInfo startInfo = new()
        {
            FileName = isCommandShim
                ? Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe"
                : launchPlan.FileName,
            WorkingDirectory = launchPlan.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = Encoding.UTF8,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        if (isCommandShim)
        {
            startInfo.ArgumentList.Add("/d");
            startInfo.ArgumentList.Add("/s");
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add(BuildCommandShimInvocation(launchPlan));
        }
        else
        {
            foreach (string argument in launchPlan.Arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }
        }

        foreach ((string key, string? value) in launchPlan.Environment)
        {
            if (value is null)
            {
                startInfo.Environment.Remove(key);
            }
            else
            {
                startInfo.Environment[key] = value;
            }
        }

        return startInfo;
    }

    private static string BuildCommandShimInvocation(PiRuntimeLaunchPlan launchPlan)
    {
        StringBuilder command = new();
        AppendQuotedCommandToken(command, launchPlan.FileName);
        foreach (string argument in launchPlan.Arguments)
        {
            command.Append(' ');
            AppendQuotedCommandToken(command, argument);
        }

        return command.ToString();
    }

    private static void AppendQuotedCommandToken(StringBuilder destination, string value)
    {
        destination.Append('"');
        destination.Append(value.Replace("\"", "\"\"", StringComparison.Ordinal));
        destination.Append('"');
    }
}

internal sealed class WindowsPiRpcProcess : IPiRpcProcess
{
    private readonly Process process;
    private readonly WindowsJobObject job;
    private int disposed;

    public WindowsPiRpcProcess(Process process, WindowsJobObject job)
    {
        this.process = process;
        this.job = job;
    }

    public Stream StandardInput => process.StandardInput.BaseStream;

    public Stream StandardOutput => process.StandardOutput.BaseStream;

    public Stream StandardError => process.StandardError.BaseStream;

    public bool HasExited => process.HasExited;

    public int? ExitCode => process.HasExited ? process.ExitCode : null;

    public async Task<int> WaitForExitAsync(CancellationToken cancellationToken)
    {
        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        return process.ExitCode;
    }

    public Task TerminateTreeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (process.HasExited)
        {
            return Task.CompletedTask;
        }

        try
        {
            job.Terminate(unchecked((uint)-1));
        }
        catch (Exception) when (!process.HasExited)
        {
            process.Kill(entireProcessTree: true);
        }

        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                await TerminateTreeAsync(CancellationToken.None).ConfigureAwait(false);
                using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(2));
                try
                {
                    await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                }
            }
        }
        finally
        {
            job.Dispose();
            process.Dispose();
        }
    }
}
