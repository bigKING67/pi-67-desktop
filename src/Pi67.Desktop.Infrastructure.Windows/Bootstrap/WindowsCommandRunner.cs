using System.Diagnostics;
using System.Text;
using Pi67.Desktop.Infrastructure.Windows.Processes;

namespace Pi67.Desktop.Infrastructure.Windows.Bootstrap;

public sealed record WindowsCommandResult(
    int ExitCode,
    string StandardOutput,
    string StandardError,
    bool OutputTruncated);

public interface IWindowsCommandRunner
{
    Task<WindowsCommandResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken);
}

public sealed class WindowsCommandRunner : IWindowsCommandRunner
{
    private const int OutputLimit = 256 * 1024;

    public async Task<WindowsCommandResult> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            throw new ArgumentException("Executable cannot be empty.", nameof(fileName));
        }
        ArgumentNullException.ThrowIfNull(arguments);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(timeout, TimeSpan.Zero);

        ProcessStartInfo startInfo = CreateStartInfo(fileName, arguments, workingDirectory);
        using Process process = new() { StartInfo = startInfo };
        using WindowsJobObject job = WindowsJobObject.CreateKillOnClose();
        if (!process.Start())
        {
            throw new InvalidOperationException($"Windows did not start '{fileName}'.");
        }
        job.Assign(process.Handle);

        using CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        Task<BoundedText> stdout = ReadBoundedAsync(process.StandardOutput, deadline.Token);
        Task<BoundedText> stderr = ReadBoundedAsync(process.StandardError, deadline.Token);
        try
        {
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited)
            {
                job.Terminate(unchecked((uint)-1));
            }
            throw;
        }

        BoundedText standardOutput = await stdout.ConfigureAwait(false);
        BoundedText standardError = await stderr.ConfigureAwait(false);
        return new WindowsCommandResult(
            process.ExitCode,
            standardOutput.Value,
            standardError.Value,
            standardOutput.Truncated || standardError.Truncated);
    }

    private static ProcessStartInfo CreateStartInfo(
        string fileName,
        IReadOnlyList<string> arguments,
        string workingDirectory)
    {
        bool commandShim = Path.GetExtension(fileName) is ".cmd" or ".bat";
        ProcessStartInfo startInfo = new()
        {
            FileName = commandShim
                ? Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe"
                : fileName,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (commandShim)
        {
            startInfo.ArgumentList.Add("/d");
            startInfo.ArgumentList.Add("/s");
            startInfo.ArgumentList.Add("/c");
            StringBuilder command = new();
            AppendQuoted(command, fileName);
            foreach (string argument in arguments)
            {
                command.Append(' ');
                AppendQuoted(command, argument);
            }
            startInfo.ArgumentList.Add(command.ToString());
        }
        else
        {
            foreach (string argument in arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }
        }
        return startInfo;
    }

    private static void AppendQuoted(StringBuilder destination, string value)
    {
        destination.Append('"');
        destination.Append(value.Replace("\"", "\"\"", StringComparison.Ordinal));
        destination.Append('"');
    }

    private static async Task<BoundedText> ReadBoundedAsync(
        StreamReader reader,
        CancellationToken cancellationToken)
    {
        char[] buffer = new char[4096];
        StringBuilder text = new(capacity: Math.Min(OutputLimit, 16 * 1024));
        bool truncated = false;
        for (;;)
        {
            int count = await reader.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0)
            {
                break;
            }

            int available = OutputLimit - text.Length;
            if (available > 0)
            {
                text.Append(buffer, 0, Math.Min(count, available));
            }
            if (count > available)
            {
                truncated = true;
            }
        }
        return new BoundedText(text.ToString(), truncated);
    }

    private sealed record BoundedText(string Value, bool Truncated);
}
