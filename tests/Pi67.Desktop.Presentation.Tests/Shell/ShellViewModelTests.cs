using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using Pi67.Desktop.Application.Bootstrap;
using Pi67.Desktop.Application.PiControl;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Application.Sessions;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Domain.Security;
using Pi67.Desktop.Domain.Sessions;
using Pi67.Desktop.Presentation.Shell;

namespace Pi67.Desktop.Presentation.Tests.Shell;

public sealed class ShellViewModelTests
{
    [Fact]
    public async Task BootstrapExecutionPreservesPlanDetailsAndProjectsStatus()
    {
        await using TestContextFixture fixture = new();
        await fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken);

        await fixture.ViewModel.ExecuteBootstrapStepAsync(
            "node",
            confirmed: true,
            TestContext.Current.CancellationToken);

        BootstrapStep step = Assert.Single(fixture.ViewModel.BootstrapSteps);
        Assert.Equal(BootstrapStepStatus.Succeeded, step.Status);
        Assert.Equal("winget install node", step.ExactCommand);
        Assert.Equal("已完成：安装 Node.js 24 LTS", fixture.ViewModel.OperationStatus);
        Assert.Equal(1, fixture.Bootstrap.ExecutionCount);
    }

    [Fact]
    public async Task RejectedImagePromptRestoresTextAndOriginalAttachment()
    {
        await using TestContextFixture fixture = new();
        await fixture.StartSessionAsync();
        fixture.Session.NextPromptResponse = new PiRpcResponse(
            "prompt-1",
            "prompt",
            false,
            null,
            "rejected");
        fixture.ViewModel.ComposerText = "Inspect this image";
        fixture.ViewModel.AddImageAttachment("screen.png", "image/png", "YWJj");

        await fixture.ViewModel.SendAsync(TestContext.Current.CancellationToken);

        Assert.Equal("Inspect this image", fixture.ViewModel.ComposerText);
        ComposerAttachmentViewModel attachment = Assert.Single(fixture.ViewModel.Attachments);
        Assert.Equal("screen.png", attachment.FileName);
        Assert.Empty(fixture.ViewModel.Transcript);
        PiImageInput image = Assert.Single(Assert.IsAssignableFrom<IReadOnlyList<PiImageInput>>(fixture.Session.LastImages));
        Assert.Equal("image/png", image.MimeType);
    }

    [Fact]
    public async Task FinalMessageInvalidatesPendingStreamingFlushWithoutDuplicateTranscript()
    {
        await using TestContextFixture fixture = new();
        await fixture.StartSessionAsync();

        await fixture.Session.PublishAsync("message_update", new
        {
            assistantMessageEvent = new { type = "text_delta", delta = "Hello" },
        });
        await fixture.Session.PublishAsync("message_end", new
        {
            message = new { content = new[] { new { type = "text", text = "Hello" } } },
        });

        await WaitUntilAsync(() => fixture.ViewModel.Transcript.Count == 1);
        await Task.Delay(100, TestContext.Current.CancellationToken);

        TranscriptItemViewModel item = Assert.Single(fixture.ViewModel.Transcript);
        Assert.Equal("Hello", item.Markdown);
        Assert.False(item.IsStreaming);
    }

    [Fact]
    public async Task ExtensionUiRequestCanBeAnsweredThroughOfficialRpcResponsePort()
    {
        await using TestContextFixture fixture = new();
        await fixture.StartSessionAsync();
        TaskCompletionSource<ExtensionUiRequest> requested = new(TaskCreationOptions.RunContinuationsAsynchronously);
        fixture.ViewModel.ExtensionUiRequested += (_, args) => requested.TrySetResult(args.Request);

        await fixture.Session.PublishAsync("extension_ui_request", new
        {
            id = "approval-1",
            method = "confirm",
            title = "Allow command",
            message = "git status",
            timeout = 5000,
        });
        ExtensionUiRequest request = await requested.Task.WaitAsync(TestContext.Current.CancellationToken);
        await fixture.ViewModel.RespondToExtensionUiAsync(
            request.Id,
            new Dictionary<string, object?> { ["confirmed"] = true },
            TestContext.Current.CancellationToken);

        Assert.Equal("approval-1", fixture.Session.LastUiRequestId);
        Assert.True(Assert.IsType<bool>(fixture.Session.LastUiResponse?["confirmed"]));
        Assert.Equal(TimeSpan.FromSeconds(5), request.Timeout);
    }

    [Fact]
    public async Task SelectingWorkspaceLoadsRedactedAuthAndDefaultModelState()
    {
        await using TestContextFixture fixture = new();
        await fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken);

        await fixture.ViewModel.SelectWorkspaceAsync(
            fixture.WorkspacePath,
            TestContext.Current.CancellationToken);

        AuthListItemViewModel auth = Assert.Single(fixture.ViewModel.AuthProviders);
        Assert.True(auth.Configured);
        Assert.Equal("credential-store", auth.Source);
        Assert.DoesNotContain("secret", auth.StatusText, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("默认：openai/gpt-test", fixture.ViewModel.DefaultModelStatus);
    }

    [Fact]
    public async Task FailedControlBridgeInitializationIsDisposedAndDetached()
    {
        await using TestContextFixture fixture = new();
        await fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken);
        fixture.Bridge.InspectTrustFailure = new IOException("control startup failed");

        await fixture.ViewModel.SelectWorkspaceAsync(
            fixture.WorkspacePath,
            TestContext.Current.CancellationToken);

        Assert.Equal(1, fixture.Bridge.DisposeCount);
        await fixture.ViewModel.SetApiKeyAsync(
            "openai",
            "test-key",
            TestContext.Current.CancellationToken);
        Assert.Equal(0, fixture.Bridge.SetApiKeyCount);
    }

    [Fact]
    public async Task CancellingAllowEmptyOAuthPromptCancelsTheFlow()
    {
        await using TestContextFixture fixture = new();
        await fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken);
        await fixture.ViewModel.SelectWorkspaceAsync(
            fixture.WorkspacePath,
            TestContext.Current.CancellationToken);
        fixture.Bridge.OAuthEvents =
        [
            new OAuthProgress(
                "flow-1",
                "interaction-1",
                "prompt",
                "Optional label",
                null,
                null,
                null,
                true,
                []),
        ];

        await fixture.ViewModel.RunOAuthAsync(
            "openai",
            static (_, _) => Task.FromResult<string?>(null),
            TestContext.Current.CancellationToken);

        Assert.Equal("flow-1", fixture.Bridge.CancelledOAuthFlowId);
        Assert.Null(fixture.Bridge.RespondedOAuthInteractionId);
        Assert.Equal("已取消 openai OAuth 登录", fixture.ViewModel.OperationStatus);
    }

    [Fact]
    public async Task OpeningLongSessionKeepsBoundedLatestTranscriptProjection()
    {
        await using TestContextFixture fixture = new();
        await fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken);
        await fixture.ViewModel.SelectWorkspaceAsync(
            fixture.WorkspacePath,
            TestContext.Current.CancellationToken);
        object[] entries = Enumerable.Range(0, 1005)
            .Select(index => (object)new
            {
                type = "message",
                message = new
                {
                    role = "assistant",
                    content = new[] { new { type = "text", text = $"message-{index}" } },
                },
            })
            .ToArray();
        fixture.Session.EntriesResponse = JsonSerializer.SerializeToElement(new { entries });

        await fixture.ViewModel.OpenSessionAsync(
            new SessionListItemViewModel(
                "thread",
                "Long session",
                Path.Combine(fixture.WorkspacePath, "long.jsonl"),
                DateTimeOffset.UtcNow),
            TestContext.Current.CancellationToken);

        Assert.Equal(1000, fixture.ViewModel.Transcript.Count);
        Assert.Equal("message-5", fixture.ViewModel.Transcript[0].Markdown);
        Assert.Equal("message-1004", fixture.ViewModel.Transcript[^1].Markdown);
        Assert.Equal("已打开会话：Long session；界面显示最近 1000 条消息", fixture.ViewModel.OperationStatus);
    }

    [Fact]
    public async Task ConcurrentDisposeSharesCleanupAndRejectsLaterInitialization()
    {
        await using TestContextFixture fixture = new();
        await fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken);
        await fixture.ViewModel.SelectWorkspaceAsync(
            fixture.WorkspacePath,
            TestContext.Current.CancellationToken);

        Task first = fixture.ViewModel.DisposeAsync().AsTask();
        Task second = fixture.ViewModel.DisposeAsync().AsTask();
        await Task.WhenAll(first, second);

        Assert.Equal(1, fixture.Session.DisposeCount);
        Assert.Equal(1, fixture.Bridge.DisposeCount);
        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            fixture.ViewModel.InitializeAsync(TestContext.Current.CancellationToken));
    }

    private static async Task WaitUntilAsync(Func<bool> predicate)
    {
        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(3));
        while (!predicate())
        {
            await Task.Delay(10, timeout.Token);
        }
    }

    private sealed class TestContextFixture : IAsyncDisposable
    {
        private readonly string root;

        public TestContextFixture()
        {
            root = Directory.CreateTempSubdirectory("pi67-presentation-").FullName;
            WorkspacePath = Path.Combine(root, "workspace");
            Directory.CreateDirectory(WorkspacePath);
            string extension = Path.Combine(root, "safety.mjs");
            File.WriteAllText(extension, "export default function () {}\n");
            Runtime = CreateRuntime();
            Bootstrap = new FakeBootstrapCoordinator();
            Session = new FakeSessionSupervisor();
            Bridge = new FakeControlBridge();
            ViewModel = new ShellViewModel(
                new FakeRuntimeLocator(Runtime),
                Bootstrap,
                Session,
                new FakeProjectionStore(),
                new FakeControlBridgeFactory(Bridge),
                extension,
                new ImmediateSynchronizationContext());
        }

        public string WorkspacePath { get; }

        public PiRuntimeDescriptor Runtime { get; }

        public FakeBootstrapCoordinator Bootstrap { get; }

        public FakeSessionSupervisor Session { get; }

        public FakeControlBridge Bridge { get; }

        public ShellViewModel ViewModel { get; }

        public async Task StartSessionAsync()
        {
            await ViewModel.InitializeAsync(TestContext.Current.CancellationToken);
            await ViewModel.SelectWorkspaceAsync(WorkspacePath, TestContext.Current.CancellationToken);
            await ViewModel.CreateSessionAsync(TestContext.Current.CancellationToken);
        }

        public async ValueTask DisposeAsync()
        {
            await ViewModel.DisposeAsync();
            Directory.Delete(root, recursive: true);
        }

        private static PiRuntimeDescriptor CreateRuntime()
        {
            SemanticVersion version = SemanticVersion.Parse("0.80.6");
            return new PiRuntimeDescriptor(
                "pi",
                "node",
                Path.GetTempPath(),
                Path.GetTempPath(),
                version.ToString(),
                RuntimeCompatibility.Evaluate(version, version, version),
                PiRuntimeLauncherKind.NodePackageEntry,
                "test");
        }
    }

    private sealed class ImmediateSynchronizationContext : SynchronizationContext
    {
        public override void Post(SendOrPostCallback callback, object? state) => callback(state);
    }

    private sealed class FakeRuntimeLocator(PiRuntimeDescriptor runtime) : IPiRuntimeLocator
    {
        public Task<PiRuntimeDescriptor> LocateAsync(CancellationToken cancellationToken) =>
            Task.FromResult(runtime);

        public Task<PiRuntimeDescriptor> ValidateAsync(
            PiRuntimeDescriptor descriptor,
            CancellationToken cancellationToken) => Task.FromResult(descriptor);

        public Task<PiRuntimeLaunchPlan> BuildLaunchPlanAsync(
            PiRuntimeDescriptor descriptor,
            PiSessionLaunchOptions options,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    private sealed class FakeBootstrapCoordinator : IBootstrapCoordinator
    {
        public int ExecutionCount { get; private set; }

        public Task<BootstrapInventory> InventoryAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new BootstrapInventory(
                "Windows",
                "X64",
                new Version(10, 0, 22631),
                [],
                ".pi",
                false,
                false,
                false));

        public Task<IReadOnlyList<BootstrapStep>> PlanAsync(
            BootstrapInventory inventory,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<BootstrapStep>>(
            [
                new BootstrapStep(
                    "node",
                    "Install Node",
                    "Install the tested Node runtime.",
                    "winget",
                    "winget install node",
                    false,
                    BootstrapStepStatus.AwaitingConfirmation,
                    null,
                    null),
            ]);

        public async IAsyncEnumerable<BootstrapStep> ExecuteStepAsync(
            string stepId,
            bool confirmed,
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            ExecutionCount++;
            yield return new BootstrapStep(
                stepId,
                "Install Node",
                string.Empty,
                string.Empty,
                null,
                false,
                BootstrapStepStatus.Running,
                null,
                null);
            await Task.Yield();
            yield return new BootstrapStep(
                stepId,
                "Install Node",
                string.Empty,
                string.Empty,
                null,
                false,
                BootstrapStepStatus.Succeeded,
                null,
                null);
        }

        public Task CancelAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class FakeProjectionStore : ISessionProjectionStore
    {
        public Task InitializeAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task UpsertSessionAsync(PiSessionReference session, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<PiSessionReference>> ListSessionsAsync(
            string? workspacePath,
            int offset,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PiSessionReference>>([]);

        public Task DeleteProjectionAsync(string desktopThreadId, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    private sealed class FakeSessionSupervisor : IPiSessionSupervisor
    {
        private readonly Channel<PiRpcEvent> events = Channel.CreateUnbounded<PiRpcEvent>();

        public PiSessionReference? CurrentSession { get; private set; }

        public PiRpcResponse NextPromptResponse { get; set; } = new(
            "prompt",
            "prompt",
            true,
            JsonSerializer.SerializeToElement(new { }),
            null);

        public IReadOnlyList<PiImageInput>? LastImages { get; private set; }

        public string? LastUiRequestId { get; private set; }

        public IReadOnlyDictionary<string, object?>? LastUiResponse { get; private set; }

        public int DisposeCount { get; private set; }

        public JsonElement EntriesResponse { get; set; } =
            JsonSerializer.SerializeToElement(new { entries = Array.Empty<object>() });

        public Task<PiSessionState> CreateSessionAsync(
            PiRuntimeDescriptor runtime,
            PiSessionLaunchOptions options,
            CancellationToken cancellationToken)
        {
            CurrentSession = new PiSessionReference(
                "thread",
                options.WorkspacePath,
                Path.Combine(options.WorkspacePath, "session.jsonl"),
                "session-id",
                options.SessionName,
                DateTimeOffset.UtcNow);
            return Task.FromResult(CreateState(CurrentSession.SessionPath));
        }

        public Task<PiSessionState> OpenSessionAsync(
            PiRuntimeDescriptor runtime,
            PiSessionLaunchOptions options,
            string sessionPath,
            CancellationToken cancellationToken) => Task.FromResult(CreateState(sessionPath));

        public Task<PiRpcResponse> SendPromptAsync(
            string message,
            IReadOnlyList<PiImageInput>? images,
            CancellationToken cancellationToken)
        {
            LastImages = images;
            return Task.FromResult(NextPromptResponse);
        }

        public Task<PiRpcResponse> SteerAsync(string message, CancellationToken cancellationToken) =>
            Task.FromResult(NextPromptResponse);

        public Task<PiRpcResponse> FollowUpAsync(string message, CancellationToken cancellationToken) =>
            Task.FromResult(NextPromptResponse);

        public Task AbortAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task<PiRpcResponse> CompactAsync(CancellationToken cancellationToken) =>
            Task.FromResult(NextPromptResponse);

        public Task<PiRpcResponse> AbortRetryAsync(CancellationToken cancellationToken) =>
            Task.FromResult(NextPromptResponse);

        public Task RespondToExtensionUiAsync(
            string requestId,
            IReadOnlyDictionary<string, object?> response,
            CancellationToken cancellationToken)
        {
            LastUiRequestId = requestId;
            LastUiResponse = response;
            return Task.CompletedTask;
        }

        public Task<JsonElement> GetEntriesAsync(string? sinceEntryId, CancellationToken cancellationToken) =>
            Task.FromResult(EntriesResponse);

        public Task<JsonElement> GetTreeAsync(CancellationToken cancellationToken) =>
            Task.FromResult(JsonSerializer.SerializeToElement(new { }));

        public IAsyncEnumerable<PiRpcEvent> ReadEventsAsync(CancellationToken cancellationToken) =>
            events.Reader.ReadAllAsync(cancellationToken);

        public Task CloseSessionAsync(CancellationToken cancellationToken)
        {
            CurrentSession = null;
            return Task.CompletedTask;
        }

        public ValueTask DisposeAsync()
        {
            DisposeCount += 1;
            events.Writer.TryComplete();
            return ValueTask.CompletedTask;
        }

        public ValueTask PublishAsync(string type, object payload) => events.Writer.WriteAsync(new PiRpcEvent(
            type,
            JsonSerializer.SerializeToElement(payload),
            DateTimeOffset.UtcNow));

        private static PiSessionState CreateState(string path) => new(
            path,
            "session-id",
            "Session",
            false,
            false,
            "medium",
            "openai",
            "gpt-test",
            0,
            0,
            JsonSerializer.SerializeToElement(new { }));
    }

    private sealed class FakeControlBridgeFactory(FakeControlBridge bridge) : IPiControlBridgeFactory
    {
        public IPiControlBridge Create(PiRuntimeDescriptor runtime, string workspacePath) => bridge;
    }

    private sealed class FakeControlBridge : IPiControlBridge
    {
        public IReadOnlyList<OAuthProgress> OAuthEvents { get; set; } = [];

        public string? CancelledOAuthFlowId { get; private set; }

        public string? RespondedOAuthInteractionId { get; private set; }

        public int DisposeCount { get; private set; }

        public int SetApiKeyCount { get; private set; }

        public Exception? InspectTrustFailure { get; set; }

        public Task<IReadOnlyList<RedactedAuthStatus>> GetAuthStatusAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<RedactedAuthStatus>>(
            [
                new RedactedAuthStatus("openai", true, "credential-store", "test@example.invalid", true, true),
            ]);

        public Task SetApiKeyAsync(string providerId, string apiKey, CancellationToken cancellationToken)
        {
            SetApiKeyCount += 1;
            return Task.CompletedTask;
        }

        public async IAsyncEnumerable<OAuthProgress> BeginOAuthAsync(
            string providerId,
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (OAuthProgress progress in OAuthEvents)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Yield();
                yield return progress;
            }
        }

        public Task RespondToOAuthAsync(
            string flowId,
            string interactionId,
            string? value,
            CancellationToken cancellationToken)
        {
            RespondedOAuthInteractionId = interactionId;
            return Task.CompletedTask;
        }

        public Task CancelOAuthAsync(string flowId, CancellationToken cancellationToken)
        {
            CancelledOAuthFlowId = flowId;
            return Task.CompletedTask;
        }

        public Task LogoutAsync(string providerId, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task<IReadOnlyList<PiModelSummary>> ListModelsAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<PiModelSummary>>(
            [
                new PiModelSummary("openai", "gpt-test", "GPT Test", ["medium"], true, true),
            ]);

        public Task RefreshModelsAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task<JsonElement> GetSettingsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(JsonSerializer.SerializeToElement(new { }));

        public Task UpdateDefaultsAsync(
            string providerId,
            string modelId,
            CancellationToken cancellationToken) => Task.CompletedTask;

        public Task<ProjectTrustStatus> InspectTrustAsync(
            string workspacePath,
            CancellationToken cancellationToken) => InspectTrustFailure is null
                ? Task.FromResult(new ProjectTrustStatus(
                    workspacePath,
                    ProjectTrustState.Unknown,
                    false,
                    [],
                    "No project resources require trust."))
                : Task.FromException<ProjectTrustStatus>(InspectTrustFailure);

        public Task<ProjectTrustStatus> SetTrustAsync(
            string workspacePath,
            ProjectTrustDecision decision,
            CancellationToken cancellationToken) => InspectTrustAsync(workspacePath, cancellationToken);

        public ValueTask DisposeAsync()
        {
            DisposeCount += 1;
            return ValueTask.CompletedTask;
        }
    }
}
