using System.IO.Pipelines;
using System.Text;
using System.Text.Json;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.PiRpc.Protocol;
using Pi67.Desktop.PiRpc.Transport;

namespace Pi67.Desktop.PiRpc.Tests.Transport;

public sealed class PiRpcTransportTests
{
    [Fact]
    public async Task SendAsyncCorrelatesResponseByRequestId()
    {
        await using FakePiRpcProcess process = new();
        await using PiRpcTransport transport = await StartAsync(process);

        Task<PiRpcResponse> pending = transport.SendAsync(
            "get_state",
            arguments: null,
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken);
        JsonElement command = await process.ReadCommandAsync(TestContext.Current.CancellationToken);
        string id = command.GetProperty("id").GetString()!;
        await process.WriteStdoutAsync(
            JsonSerializer.Serialize(new
            {
                id,
                type = "response",
                command = "get_state",
                success = true,
                data = new { isStreaming = false },
            }),
            TestContext.Current.CancellationToken);

        PiRpcResponse response = await pending;
        Assert.True(response.Success);
        Assert.Equal("get_state", response.Command);
    }

    [Fact]
    public async Task SendAsyncPropagatesMalformedStdoutToPendingRequest()
    {
        await using FakePiRpcProcess process = new();
        await using PiRpcTransport transport = await StartAsync(process);
        Task<PiRpcResponse> pending = transport.SendAsync(
            "get_state",
            arguments: null,
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken);
        _ = await process.ReadCommandAsync(TestContext.Current.CancellationToken);

        await process.WriteStdoutAsync("{not-json", TestContext.Current.CancellationToken);

        PiRpcProtocolException error = await Assert.ThrowsAsync<PiRpcProtocolException>(() => pending);
        Assert.Equal("rpc.invalid_json", error.Code);
    }

    [Fact]
    public async Task SendAsyncFailsWhenProcessExitsBeforeResponse()
    {
        await using FakePiRpcProcess process = new();
        await using PiRpcTransport transport = await StartAsync(process);
        Task<PiRpcResponse> pending = transport.SendAsync(
            "get_state",
            arguments: null,
            TimeSpan.FromSeconds(5),
            TestContext.Current.CancellationToken);
        _ = await process.ReadCommandAsync(TestContext.Current.CancellationToken);

        process.Exit(17);

        PiRpcProtocolException error = await Assert.ThrowsAsync<PiRpcProtocolException>(() => pending);
        Assert.Equal("rpc.process_exit", error.Code);
    }

    [Fact]
    public async Task CancelledStopWaitingForStartupDoesNotPoisonTheTransport()
    {
        await using FakePiRpcProcess process = new();
        BlockingPiRpcProcessFactory factory = new(process);
        await using PiRpcTransport transport = new(factory);
        Task start = transport.StartAsync(CreatePlan(), TestContext.Current.CancellationToken);
        await factory.StartEntered.Task.WaitAsync(TestContext.Current.CancellationToken);

        using CancellationTokenSource stopCancellation = new();
        Task stop = transport.StopAsync("cancelled before lifecycle ownership", stopCancellation.Token);
        stopCancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => stop);

        factory.ReleaseStart();
        await start;
        Assert.True(transport.IsRunning);

        process.ExitOnNextWait = true;
        await transport.StopAsync("test complete", TestContext.Current.CancellationToken);
        Assert.Equal(1, process.DisposeCount);
    }

    [Fact]
    public async Task StoppedTransportCanStartAnotherSession()
    {
        await using FakePiRpcProcess first = new();
        await using FakePiRpcProcess second = new();
        await using PiRpcTransport transport = new(new QueuePiRpcProcessFactory(first, second));

        await transport.StartAsync(CreatePlan(), TestContext.Current.CancellationToken);
        first.ExitOnNextWait = true;
        await transport.StopAsync("first session closed", TestContext.Current.CancellationToken);

        await transport.StartAsync(CreatePlan(), TestContext.Current.CancellationToken);
        Assert.True(transport.IsRunning);
        second.ExitOnNextWait = true;
        await transport.StopAsync("second session closed", TestContext.Current.CancellationToken);

        Assert.Equal(1, first.DisposeCount);
        Assert.Equal(1, second.DisposeCount);
    }

    private static async Task<PiRpcTransport> StartAsync(FakePiRpcProcess process)
    {
        PiRpcTransport transport = new(new FakePiRpcProcessFactory(process));
        await transport.StartAsync(CreatePlan(), TestContext.Current.CancellationToken);
        return transport;
    }

    private static PiRuntimeLaunchPlan CreatePlan()
    {
        SemanticVersion version = SemanticVersion.Parse("0.80.6");
        PiRuntimeDescriptor runtime = new(
            "pi",
            null,
            null,
            ".pi",
            version.ToString(),
            RuntimeCompatibility.Evaluate(version, version, version),
            PiRuntimeLauncherKind.NativeExecutable,
            "test");
        return new PiRuntimeLaunchPlan("pi", ["--mode", "rpc"], ".", new Dictionary<string, string?>(), runtime);
    }

    private sealed class FakePiRpcProcessFactory(FakePiRpcProcess process) : IPiRpcProcessFactory
    {
        public Task<IPiRpcProcess> StartAsync(
            PiRuntimeLaunchPlan launchPlan,
            CancellationToken cancellationToken) => Task.FromResult<IPiRpcProcess>(process);
    }

    private sealed class BlockingPiRpcProcessFactory(FakePiRpcProcess process) : IPiRpcProcessFactory
    {
        private readonly TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource StartEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<IPiRpcProcess> StartAsync(
            PiRuntimeLaunchPlan launchPlan,
            CancellationToken cancellationToken)
        {
            StartEntered.TrySetResult();
            await release.Task.WaitAsync(cancellationToken);
            return process;
        }

        public void ReleaseStart() => release.TrySetResult();
    }

    private sealed class QueuePiRpcProcessFactory(params FakePiRpcProcess[] processes) : IPiRpcProcessFactory
    {
        private readonly Queue<FakePiRpcProcess> remaining = new(processes);

        public Task<IPiRpcProcess> StartAsync(
            PiRuntimeLaunchPlan launchPlan,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<IPiRpcProcess>(remaining.Dequeue());
        }
    }

    private sealed class FakePiRpcProcess : IPiRpcProcess
    {
        private readonly Pipe stdin = new();
        private readonly Pipe stdout = new();
        private readonly Pipe stderr = new();
        private readonly TaskCompletionSource<int> exit = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool ExitOnNextWait { get; set; }

        public int DisposeCount { get; private set; }

        public Stream StandardInput => stdin.Writer.AsStream(leaveOpen: true);

        public Stream StandardOutput => stdout.Reader.AsStream(leaveOpen: true);

        public Stream StandardError => stderr.Reader.AsStream(leaveOpen: true);

        public bool HasExited => exit.Task.IsCompleted;

        public int? ExitCode => exit.Task.IsCompletedSuccessfully ? exit.Task.Result : null;

        public Task<int> WaitForExitAsync(CancellationToken cancellationToken)
        {
            if (ExitOnNextWait)
            {
                ExitOnNextWait = false;
                Exit(0);
            }
            return exit.Task.WaitAsync(cancellationToken);
        }

        public Task TerminateTreeAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Exit(-1);
            return Task.CompletedTask;
        }

        public async Task<JsonElement> ReadCommandAsync(CancellationToken cancellationToken)
        {
            Stream input = stdin.Reader.AsStream(leaveOpen: true);
            using StreamReader reader = new(input, Encoding.UTF8, leaveOpen: true);
            string? line = await reader.ReadLineAsync(cancellationToken);
            Assert.NotNull(line);
            using JsonDocument document = JsonDocument.Parse(line);
            return document.RootElement.Clone();
        }

        public async Task WriteStdoutAsync(string json, CancellationToken cancellationToken)
        {
            byte[] payload = Encoding.UTF8.GetBytes($"{json}\n");
            await stdout.Writer.WriteAsync(payload, cancellationToken);
            await stdout.Writer.FlushAsync(cancellationToken);
        }

        public void Exit(int code)
        {
            if (exit.TrySetResult(code))
            {
                stdout.Writer.Complete();
                stderr.Writer.Complete();
            }
        }

        public async ValueTask DisposeAsync()
        {
            DisposeCount += 1;
            Exit(0);
            await stdin.Reader.CompleteAsync();
            await stdin.Writer.CompleteAsync();
            await stdout.Reader.CompleteAsync();
            await stderr.Reader.CompleteAsync();
        }
    }
}
