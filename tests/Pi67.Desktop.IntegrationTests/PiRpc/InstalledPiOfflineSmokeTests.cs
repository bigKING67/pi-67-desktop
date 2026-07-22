using System.Diagnostics;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.PiRpc.Transport;

namespace Pi67.Desktop.IntegrationTests.PiRpc;

public sealed class InstalledPiOfflineSmokeTests
{
    [Fact]
    public async Task InstalledPiAnswersGetStateThroughRealOfflineRpc()
    {
        if (Environment.GetEnvironmentVariable("PI67_RUN_LIVE_PI_TESTS") != "1")
        {
            Assert.Skip("Set PI67_RUN_LIVE_PI_TESTS=1 to run against the selected installed Pi runtime.");
        }

        string executable = Environment.GetEnvironmentVariable("PI67_TEST_PI_EXECUTABLE") ?? "pi";
        SemanticVersion version = SemanticVersion.Parse("0.80.6");
        PiRuntimeDescriptor runtime = new(
            executable,
            null,
            null,
            Environment.GetEnvironmentVariable("PI_CODING_AGENT_DIR")
                ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pi", "agent"),
            version.ToString(),
            RuntimeCompatibility.Evaluate(version, version, version),
            PiRuntimeLauncherKind.NativeExecutable,
            "integration-test");
        PiRuntimeLaunchPlan plan = new(
            executable,
            ["--mode", "rpc", "--no-session", "--offline", "--no-approve"],
            Path.GetTempPath(),
            new Dictionary<string, string?>
            {
                ["PI_OFFLINE"] = "1",
                ["PI_TELEMETRY"] = "0",
            },
            runtime);
        await using PiRpcTransport transport = new(new TestProcessFactory());

        await transport.StartAsync(plan, TestContext.Current.CancellationToken);
        PiRpcResponse response = await transport.SendAsync(
            "get_state",
            arguments: null,
            TimeSpan.FromSeconds(20),
            TestContext.Current.CancellationToken);

        Assert.True(response.Success, response.Error);
        Assert.Equal("get_state", response.Command);
        Assert.Equal(false, response.Data?.GetProperty("isStreaming").GetBoolean());
    }

    private sealed class TestProcessFactory : IPiRpcProcessFactory
    {
        public Task<IPiRpcProcess> StartAsync(
            PiRuntimeLaunchPlan launchPlan,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ProcessStartInfo startInfo = new()
            {
                FileName = launchPlan.FileName,
                WorkingDirectory = launchPlan.WorkingDirectory,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            foreach (string argument in launchPlan.Arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }
            foreach ((string key, string? value) in launchPlan.Environment)
            {
                if (value is null) startInfo.Environment.Remove(key);
                else startInfo.Environment[key] = value;
            }

            Process process = new() { StartInfo = startInfo };
            if (!process.Start())
            {
                process.Dispose();
                throw new InvalidOperationException("Could not start installed Pi for the offline RPC smoke test.");
            }
            return Task.FromResult<IPiRpcProcess>(new TestProcess(process));
        }
    }

    private sealed class TestProcess(Process process) : IPiRpcProcess
    {
        public Stream StandardInput => process.StandardInput.BaseStream;

        public Stream StandardOutput => process.StandardOutput.BaseStream;

        public Stream StandardError => process.StandardError.BaseStream;

        public bool HasExited => process.HasExited;

        public int? ExitCode => process.HasExited ? process.ExitCode : null;

        public async Task<int> WaitForExitAsync(CancellationToken cancellationToken)
        {
            await process.WaitForExitAsync(cancellationToken);
            return process.ExitCode;
        }

        public Task TerminateTreeAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            return Task.CompletedTask;
        }

        public async ValueTask DisposeAsync()
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
            }
            process.Dispose();
        }
    }
}
