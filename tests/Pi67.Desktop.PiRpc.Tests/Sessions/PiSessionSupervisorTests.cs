using System.Runtime.CompilerServices;
using System.Text.Json;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Application.Sessions;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Domain.Sessions;
using Pi67.Desktop.PiRpc.Sessions;

namespace Pi67.Desktop.PiRpc.Tests.Sessions;

public sealed class PiSessionSupervisorTests
{
    [Fact]
    public async Task CreateSessionProjectsCanonicalPiSessionWithoutTranslatingIt()
    {
        string workspace = Path.GetTempPath();
        string sessionPath = Path.Combine(workspace, "session.jsonl");
        FakeRuntimeLocator locator = new();
        FakeTransport transport = new(sessionPath);
        FakeProjectionStore projectionStore = new();
        await using PiSessionSupervisor supervisor = new(locator, transport, projectionStore);
        PiSessionLaunchOptions options = new(workspace, null, "Test session", true, true, []);

        PiSessionState state = await supervisor.CreateSessionAsync(
            CreateRuntime(),
            options,
            TestContext.Current.CancellationToken);

        Assert.Equal(sessionPath, state.SessionFile);
        Assert.NotNull(supervisor.CurrentSession);
        Assert.Equal(sessionPath, supervisor.CurrentSession.SessionPath);
        Assert.Same(supervisor.CurrentSession, projectionStore.Stored);
        Assert.Equal(sessionPath, projectionStore.Stored?.SessionPath);
    }

    [Fact]
    public async Task SendPromptUsesOfficialImageContentShape()
    {
        FakeRuntimeLocator locator = new();
        FakeTransport transport = new(Path.Combine(Path.GetTempPath(), "session.jsonl"));
        await using PiSessionSupervisor supervisor = new(locator, transport, new FakeProjectionStore());
        await supervisor.CreateSessionAsync(
            CreateRuntime(),
            new PiSessionLaunchOptions(Path.GetTempPath(), null, null, true, true, []),
            TestContext.Current.CancellationToken);

        _ = await supervisor.SendPromptAsync(
            "Inspect image",
            [new PiImageInput("image/png", "YWJj")],
            TestContext.Current.CancellationToken);

        Assert.Equal("prompt", transport.LastCommand);
        object image = Assert.Single(Assert.IsAssignableFrom<object[]>(transport.LastArguments?["images"]));
        JsonElement serialized = JsonSerializer.SerializeToElement(image);
        Assert.Equal("image", serialized.GetProperty("type").GetString());
        Assert.Equal("image/png", serialized.GetProperty("mimeType").GetString());
    }

    [Fact]
    public async Task DisposeIsIdempotentAndRejectsAnotherSession()
    {
        FakeTransport transport = new(Path.Combine(Path.GetTempPath(), "session.jsonl"));
        PiSessionSupervisor supervisor = new(new FakeRuntimeLocator(), transport, new FakeProjectionStore());

        await supervisor.DisposeAsync();
        await supervisor.DisposeAsync();

        Assert.Equal(1, transport.DisposeCount);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => supervisor.CreateSessionAsync(
            CreateRuntime(),
            new PiSessionLaunchOptions(Path.GetTempPath(), null, null, true, true, []),
            TestContext.Current.CancellationToken));
    }

    private static PiRuntimeDescriptor CreateRuntime()
    {
        SemanticVersion version = SemanticVersion.Parse("0.80.6");
        return new PiRuntimeDescriptor(
            "pi",
            null,
            null,
            ".pi",
            version.ToString(),
            RuntimeCompatibility.Evaluate(version, version, version),
            PiRuntimeLauncherKind.NativeExecutable,
            "test");
    }

    private sealed class FakeRuntimeLocator : IPiRuntimeLocator
    {
        public Task<PiRuntimeDescriptor> LocateAsync(CancellationToken cancellationToken) =>
            Task.FromResult(CreateRuntime());

        public Task<PiRuntimeDescriptor> ValidateAsync(
            PiRuntimeDescriptor runtime,
            CancellationToken cancellationToken) => Task.FromResult(runtime);

        public Task<PiRuntimeLaunchPlan> BuildLaunchPlanAsync(
            PiRuntimeDescriptor runtime,
            PiSessionLaunchOptions options,
            CancellationToken cancellationToken) => Task.FromResult(new PiRuntimeLaunchPlan(
                "pi",
                ["--mode", "rpc"],
                options.WorkspacePath,
                new Dictionary<string, string?>(),
                runtime));
    }

    private sealed class FakeTransport(string sessionPath) : IPiRpcTransport
    {
        public bool IsRunning { get; private set; }

        public string? LastCommand { get; private set; }

        public IReadOnlyDictionary<string, object?>? LastArguments { get; private set; }

        public int DisposeCount { get; private set; }

        public Task StartAsync(PiRuntimeLaunchPlan launchPlan, CancellationToken cancellationToken)
        {
            IsRunning = true;
            return Task.CompletedTask;
        }

        public Task<PiRpcResponse> SendAsync(
            string command,
            IReadOnlyDictionary<string, object?>? arguments,
            TimeSpan timeout,
            CancellationToken cancellationToken)
        {
            LastCommand = command;
            LastArguments = arguments;
            JsonElement? data = command == "get_state"
                ? JsonSerializer.SerializeToElement(new
                {
                    sessionFile = sessionPath,
                    sessionId = "session-id",
                    sessionName = "Test session",
                    isStreaming = false,
                    isCompacting = false,
                    thinkingLevel = "medium",
                    model = new { provider = "test", id = "model" },
                    messageCount = 0,
                    pendingMessageCount = 0,
                })
                : JsonSerializer.SerializeToElement(new { });
            return Task.FromResult(new PiRpcResponse("test", command, true, data, null));
        }

        public Task RespondToUiAsync(string requestId, object? result, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public async IAsyncEnumerable<PiRpcEvent> ReadEventsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield break;
        }

        public Task AbortAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task StopAsync(string reason, CancellationToken cancellationToken)
        {
            IsRunning = false;
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            DisposeCount += 1;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class FakeProjectionStore : ISessionProjectionStore
    {
        public PiSessionReference? Stored { get; private set; }

        public Task InitializeAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task UpsertSessionAsync(PiSessionReference session, CancellationToken cancellationToken)
        {
            Stored = session;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<PiSessionReference>> ListSessionsAsync(
            string? workspacePath,
            int offset,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PiSessionReference>>(Stored is null ? [] : [Stored]);

        public Task DeleteProjectionAsync(string desktopThreadId, CancellationToken cancellationToken)
        {
            Stored = null;
            return Task.CompletedTask;
        }
    }
}
