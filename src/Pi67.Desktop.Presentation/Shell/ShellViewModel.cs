using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using Pi67.Desktop.Application.Bootstrap;
using Pi67.Desktop.Application.PiControl;
using Pi67.Desktop.Application.Runtime;
using Pi67.Desktop.Application.Sessions;
using Pi67.Desktop.Domain.Compatibility;
using Pi67.Desktop.Domain.Security;
using Pi67.Desktop.Domain.Sessions;

namespace Pi67.Desktop.Presentation.Shell;

public sealed class ShellViewModel : ObservableObject, IAsyncDisposable
{
    private const long MaximumAttachmentBytes = 10 * 1024 * 1024;
    private const long MaximumTotalAttachmentBytes = 20 * 1024 * 1024;
    private const int MaximumTranscriptItems = 1000;
    private const int MaximumToolActivities = 200;

    private readonly IPiRuntimeLocator runtimeLocator;
    private readonly IBootstrapCoordinator bootstrapCoordinator;
    private readonly IPiSessionSupervisor sessionSupervisor;
    private readonly ISessionProjectionStore projectionStore;
    private readonly IPiControlBridgeFactory controlBridgeFactory;
    private readonly SynchronizationContext uiContext;
    private readonly string safetyExtensionPath;
    private readonly IShellTextProvider text;
    private readonly object streamingGate = new();
    private readonly StringBuilder streamingText = new();
    private readonly SemaphoreSlim sessionLifecycleGate = new(1, 1);
    private readonly object disposeGate = new();

    private PiRuntimeDescriptor? runtime;
    private IPiControlBridge? controlBridge;
    private CancellationTokenSource? sessionCancellation;
    private Task? eventPump;
    private TranscriptItemViewModel? streamingItem;
    private string workspacePath = string.Empty;
    private string composerText = string.Empty;
    private string runtimeStatus;
    private string runtimeDetail = string.Empty;
    private string trustStatus;
    private string operationStatus;
    private bool isBusy;
    private bool isSessionActive;
    private bool isAgentRunning;
    private int flushScheduled;
    private int streamVersion;
    private int lastFlushedLength;
    private Task? disposeTask;
    private int disposed;
    private bool isBootstrapRunning;
    private string defaultModelStatus;
    private ProjectTrustDecision trustDecision = ProjectTrustDecision.Deny;

    public ShellViewModel(
        IPiRuntimeLocator runtimeLocator,
        IBootstrapCoordinator bootstrapCoordinator,
        IPiSessionSupervisor sessionSupervisor,
        ISessionProjectionStore projectionStore,
        IPiControlBridgeFactory controlBridgeFactory,
        string safetyExtensionPath,
        SynchronizationContext? uiContext = null,
        IShellTextProvider? textProvider = null)
    {
        this.runtimeLocator = runtimeLocator ?? throw new ArgumentNullException(nameof(runtimeLocator));
        this.bootstrapCoordinator = bootstrapCoordinator ?? throw new ArgumentNullException(nameof(bootstrapCoordinator));
        this.sessionSupervisor = sessionSupervisor ?? throw new ArgumentNullException(nameof(sessionSupervisor));
        this.projectionStore = projectionStore ?? throw new ArgumentNullException(nameof(projectionStore));
        this.controlBridgeFactory = controlBridgeFactory ?? throw new ArgumentNullException(nameof(controlBridgeFactory));
        this.safetyExtensionPath = Path.GetFullPath(safetyExtensionPath);
        this.uiContext = uiContext ?? SynchronizationContext.Current ?? new SynchronizationContext();
        text = textProvider ?? new ChineseShellTextProvider();
        runtimeStatus = text.Get("Runtime.Checking");
        trustStatus = text.Get("Trust.NotSelected");
        operationStatus = text.Get("Operation.Ready");
        defaultModelStatus = text.Get("Model.NotRead");
    }

    public event EventHandler<ExtensionUiRequestEventArgs>? ExtensionUiRequested;

    public event EventHandler<TitleRequestedEventArgs>? TitleRequested;

    public ObservableCollection<SessionListItemViewModel> Sessions { get; } = [];

    public ObservableCollection<TranscriptItemViewModel> Transcript { get; } = [];

    public ObservableCollection<ToolActivityViewModel> ToolActivities { get; } = [];

    public ObservableCollection<BootstrapStep> BootstrapSteps { get; } = [];

    public ObservableCollection<ModelListItemViewModel> Models { get; } = [];

    public ObservableCollection<AuthListItemViewModel> AuthProviders { get; } = [];

    public ObservableCollection<ComposerAttachmentViewModel> Attachments { get; } = [];

    public string WorkspacePath
    {
        get => workspacePath;
        private set => SetProperty(ref workspacePath, value);
    }

    public string WorkspaceDisplayName => string.IsNullOrWhiteSpace(WorkspacePath)
        ? text.Get("Workspace.None")
        : Path.GetFileName(WorkspacePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));

    public string ComposerText
    {
        get => composerText;
        set => SetProperty(ref composerText, value);
    }

    public string RuntimeStatus
    {
        get => runtimeStatus;
        private set => SetProperty(ref runtimeStatus, value);
    }

    public string RuntimeDetail
    {
        get => runtimeDetail;
        private set => SetProperty(ref runtimeDetail, value);
    }

    public string TrustStatus
    {
        get => trustStatus;
        private set => SetProperty(ref trustStatus, value);
    }

    public string OperationStatus
    {
        get => operationStatus;
        private set => SetProperty(ref operationStatus, value);
    }

    public bool IsBusy
    {
        get => isBusy;
        private set => SetProperty(ref isBusy, value);
    }

    public bool IsSessionActive
    {
        get => isSessionActive;
        private set => SetProperty(ref isSessionActive, value);
    }

    public bool IsAgentRunning
    {
        get => isAgentRunning;
        private set => SetProperty(ref isAgentRunning, value);
    }

    public bool IsBootstrapRunning
    {
        get => isBootstrapRunning;
        private set => SetProperty(ref isBootstrapRunning, value);
    }

    public string DefaultModelStatus
    {
        get => defaultModelStatus;
        private set => SetProperty(ref defaultModelStatus, value);
    }

    public ProjectTrustDecision TrustDecision
    {
        get => trustDecision;
        private set => SetProperty(ref trustDecision, value);
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        IsBusy = true;
        try
        {
            await projectionStore.InitializeAsync(cancellationToken);
            BootstrapInventory inventory = await bootstrapCoordinator.InventoryAsync(cancellationToken);
            IReadOnlyList<BootstrapStep> plan = await bootstrapCoordinator.PlanAsync(inventory, cancellationToken);
            BootstrapSteps.Clear();
            foreach (BootstrapStep step in plan) BootstrapSteps.Add(LocalizeBootstrapStep(step));

            runtime = await runtimeLocator.LocateAsync(cancellationToken);
            RuntimeStatus = runtime.Compatibility.Status switch
            {
                RuntimeCompatibilityStatus.Supported => text.Get("Runtime.Verified"),
                RuntimeCompatibilityStatus.Unverified => text.Get("Runtime.Unverified"),
                RuntimeCompatibilityStatus.TooOld => text.Get("Runtime.TooOld"),
                _ => text.Get("Runtime.Unavailable"),
            };
            RuntimeDetail = runtime.Compatibility.Reason;
            OperationStatus = plan.Count == 0
                ? text.Get("Runtime.CheckComplete")
                : text.Get("Runtime.PreparationRequired");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            RuntimeStatus = text.Get("Runtime.CheckFailed");
            RuntimeDetail = Bound(exception.Message, 300);
            OperationStatus = text.Get("Runtime.CheckRetry");
        }
        finally
        {
            IsBusy = false;
        }
    }

    public async Task SelectWorkspaceAsync(string path, CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        if (string.IsNullOrWhiteSpace(path)) return;
        string canonical = Path.GetFullPath(path);
        if (!Directory.Exists(canonical)) throw new DirectoryNotFoundException(canonical);

        await CloseSessionAsync(cancellationToken);
        IPiControlBridge? previousBridge = controlBridge;
        controlBridge = null;
        if (previousBridge is not null) await previousBridge.DisposeAsync();
        WorkspacePath = canonical;
        OnPropertyChanged(nameof(WorkspaceDisplayName));
        TrustDecision = ProjectTrustDecision.Deny;
        TrustStatus = text.Get("Trust.NotTrusted");
        await RefreshSessionsAsync(cancellationToken);

        if (runtime?.NodeExecutable is not null && runtime.PackageRoot is not null)
        {
            IPiControlBridge? candidate = null;
            try
            {
                candidate = controlBridgeFactory.Create(runtime, canonical);
                controlBridge = candidate;
                ProjectTrustStatus trust = await candidate.InspectTrustAsync(canonical, cancellationToken);
                ApplyTrustStatus(trust);
                await RefreshControlDataAsync(cancellationToken);
            }
            catch (Exception exception) when (exception is IOException or InvalidOperationException)
            {
                if (ReferenceEquals(controlBridge, candidate)) controlBridge = null;
                if (candidate is not null) await candidate.DisposeAsync();
                OperationStatus = text.Format("Operation.ControlUnavailableDetail", exception.Message);
            }
            catch
            {
                if (ReferenceEquals(controlBridge, candidate)) controlBridge = null;
                if (candidate is not null) await candidate.DisposeAsync();
                throw;
            }
        }
    }

    public async Task SetProjectTrustAsync(
        ProjectTrustDecision decision,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(WorkspacePath)) return;
        TrustDecision = decision;
        if (controlBridge is not null)
        {
            ProjectTrustStatus status = await controlBridge.SetTrustAsync(
                WorkspacePath,
                decision,
                cancellationToken);
            ApplyTrustStatus(status);
        }
        else
        {
            TrustStatus = decision switch
            {
                ProjectTrustDecision.TrustOnce => text.Get("Trust.Once"),
                ProjectTrustDecision.TrustAndPersist => text.Get("Trust.PersistWhenAvailable"),
                _ => text.Get("Trust.DenyResources"),
            };
        }
    }

    public async Task ExecuteBootstrapStepAsync(
        string stepId,
        bool confirmed,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(stepId)) return;
        if (IsBootstrapRunning)
        {
            OperationStatus = text.Get("Operation.BootstrapBusy");
            return;
        }

        IsBootstrapRunning = true;
        IsBusy = true;
        try
        {
            await foreach (BootstrapStep update in bootstrapCoordinator.ExecuteStepAsync(
                stepId,
                confirmed,
                cancellationToken))
            {
                BootstrapStep localizedUpdate = LocalizeBootstrapStep(update);
                ReplaceBootstrapStep(localizedUpdate);
                OperationStatus = localizedUpdate.Status switch
                {
                    BootstrapStepStatus.AwaitingConfirmation => text.Format("Operation.AwaitingConfirmation", localizedUpdate.DisplayName),
                    BootstrapStepStatus.Running => text.Format("Operation.RunningStep", localizedUpdate.DisplayName),
                    BootstrapStepStatus.Succeeded => text.Format("Operation.StepComplete", localizedUpdate.DisplayName),
                    BootstrapStepStatus.Failed => text.Format("Operation.StepFailed", localizedUpdate.FailureMessage ?? localizedUpdate.DisplayName),
                    BootstrapStepStatus.Cancelled => text.Format("Operation.StepCancelled", localizedUpdate.DisplayName),
                    _ => OperationStatus,
                };
            }
        }
        catch (OperationCanceledException)
        {
            OperationStatus = text.Get("Operation.BootstrapCancelled");
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            OperationStatus = text.Format("Operation.StepFailed", exception.Message);
        }
        finally
        {
            IsBootstrapRunning = false;
            IsBusy = false;
        }
    }

    public Task CancelBootstrapAsync(CancellationToken cancellationToken) =>
        bootstrapCoordinator.CancelAsync(cancellationToken);

    public void ReportShutdownStarting() => OperationStatus = text.Get("Operation.ShuttingDown");

    public void ReportUnexpectedUiFailure() => OperationStatus = text.Get("Operation.UnexpectedFailure");

    public async Task CreateSessionAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        if (runtime is null || !runtime.Compatibility.CanRunRpc)
        {
            OperationStatus = text.Get("Operation.RuntimeRequired");
            return;
        }
        if (string.IsNullOrWhiteSpace(WorkspacePath))
        {
            OperationStatus = text.Get("Operation.WorkspaceRequired");
            return;
        }
        if (!File.Exists(safetyExtensionPath))
        {
            OperationStatus = text.Get("Operation.SafetyMissingCreate");
            return;
        }

        await sessionLifecycleGate.WaitAsync(cancellationToken);
        IsBusy = true;
        try
        {
            ThrowIfDisposed();
            if (IsSessionActive) await CloseSessionCoreAsync(cancellationToken);
            PiSessionLaunchOptions options = new(
                WorkspacePath,
                SessionPath: null,
                SessionName: WorkspaceDisplayName,
                PersistSession: true,
                Offline: false,
                ExtensionPaths: [safetyExtensionPath],
                ProjectTrustDecision: TrustDecision);
            _ = await sessionSupervisor.CreateSessionAsync(runtime, options, cancellationToken);
            IsSessionActive = true;
            OperationStatus = text.Get("Operation.SessionStarted");
            sessionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            eventPump = Task.Run(
                () => PumpEventsAsync(sessionCancellation.Token),
                sessionCancellation.Token);
            await RefreshSessionsAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            OperationStatus = text.Format("Operation.SessionStartFailed", exception.Message);
        }
        finally
        {
            IsBusy = false;
            sessionLifecycleGate.Release();
        }
    }

    public async Task OpenSessionAsync(
        SessionListItemViewModel session,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ThrowIfDisposed();
        if (runtime is null || !runtime.Compatibility.CanRunRpc || string.IsNullOrWhiteSpace(WorkspacePath))
        {
            OperationStatus = text.Get("Operation.RuntimeOrWorkspaceMissing");
            return;
        }
        if (!File.Exists(safetyExtensionPath))
        {
            OperationStatus = text.Get("Operation.SafetyMissingOpen");
            return;
        }

        await sessionLifecycleGate.WaitAsync(cancellationToken);
        IsBusy = true;
        try
        {
            ThrowIfDisposed();
            if (IsSessionActive) await CloseSessionCoreAsync(cancellationToken);
            PiSessionLaunchOptions options = new(
                WorkspacePath,
                SessionPath: session.SessionPath,
                SessionName: session.DisplayName,
                PersistSession: true,
                Offline: false,
                ExtensionPaths: [safetyExtensionPath],
                ProjectTrustDecision: TrustDecision);
            _ = await sessionSupervisor.OpenSessionAsync(
                runtime,
                options,
                session.SessionPath,
                cancellationToken);
            IsSessionActive = true;
            sessionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            eventPump = Task.Run(
                () => PumpEventsAsync(sessionCancellation.Token),
                sessionCancellation.Token);
            JsonElement entries = await sessionSupervisor.GetEntriesAsync(null, cancellationToken);
            bool transcriptLimited = ProjectExistingEntries(entries);
            OperationStatus = transcriptLimited
                ? text.Format("Operation.SessionOpenedLimited", session.DisplayName, MaximumTranscriptItems)
                : text.Format("Operation.SessionOpened", session.DisplayName);
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or UnauthorizedAccessException)
        {
            OperationStatus = text.Format("Operation.SessionOpenFailed", exception.Message);
        }
        finally
        {
            IsBusy = false;
            sessionLifecycleGate.Release();
        }
    }

    public async Task SendAsync(CancellationToken cancellationToken)
    {
        string message = ComposerText;
        if (!IsSessionActive || (string.IsNullOrWhiteSpace(message) && Attachments.Count == 0)) return;
        if (IsAgentRunning && Attachments.Count > 0)
        {
            OperationStatus = text.Get("Operation.ImageDuringFollowUp");
            return;
        }

        ComposerAttachmentViewModel[] attachmentSnapshot = Attachments.ToArray();
        PiImageInput[]? images = attachmentSnapshot.Length == 0
            ? null
            : attachmentSnapshot.Select(static attachment => new PiImageInput(
                attachment.MimeType,
                attachment.Base64Data)).ToArray();
        string attachmentSummary = attachmentSnapshot.Length == 0
            ? string.Empty
            : $"\n\n{text.Format("Transcript.Attachments", string.Join("、", attachmentSnapshot.Select(static item => item.FileName)))}";
        ComposerText = string.Empty;
        Attachments.Clear();
        TranscriptItemViewModel transcriptItem = new(text.Get("Transcript.User"), message + attachmentSummary, isStreaming: false);
        AppendTranscript(transcriptItem);
        try
        {
            PiRpcResponse response = IsAgentRunning
                ? await sessionSupervisor.FollowUpAsync(message, cancellationToken)
                : await sessionSupervisor.SendPromptAsync(message, images, cancellationToken);
            OperationStatus = response.Success
                ? text.Get("Operation.PromptAccepted")
                : text.Format("Operation.PromptRejected", response.Error);
            if (!response.Success)
            {
                RestoreComposer(message, attachmentSnapshot, transcriptItem);
            }
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or OperationCanceledException)
        {
            RestoreComposer(message, attachmentSnapshot, transcriptItem);
            OperationStatus = exception is OperationCanceledException
                ? text.Get("Operation.SendCancelled")
                : text.Format("Operation.SendFailed", exception.Message);
        }
    }

    public void AddImageAttachment(string fileName, string mimeType, string base64Data)
    {
        if (string.IsNullOrWhiteSpace(fileName)) throw new ArgumentException("File name cannot be empty.", nameof(fileName));
        if (mimeType is not ("image/png" or "image/jpeg" or "image/gif" or "image/webp"))
        {
            throw new ArgumentException("Unsupported image type.", nameof(mimeType));
        }

        byte[] decoded;
        try
        {
            decoded = Convert.FromBase64String(base64Data);
        }
        catch (FormatException exception)
        {
            throw new ArgumentException("Attachment data must be valid base64.", nameof(base64Data), exception);
        }
        if (decoded.LongLength == 0 || decoded.LongLength > MaximumAttachmentBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(base64Data), "Each image must be between 1 byte and 10 MB.");
        }
        long total = Attachments.Sum(static item => item.DecodedBytes) + decoded.LongLength;
        if (total > MaximumTotalAttachmentBytes)
        {
            throw new InvalidOperationException("Image attachments cannot exceed 20 MB per prompt.");
        }

        Attachments.Add(new ComposerAttachmentViewModel(
            Guid.NewGuid().ToString("N"),
            Path.GetFileName(fileName),
            mimeType,
            base64Data,
            decoded.LongLength));
    }

    public void RemoveImageAttachment(string attachmentId)
    {
        ComposerAttachmentViewModel? item = Attachments.FirstOrDefault(
            attachment => attachment.Id == attachmentId);
        if (item is not null) Attachments.Remove(item);
    }

    public async Task StopAgentAsync(CancellationToken cancellationToken)
    {
        if (!IsSessionActive) return;
        await sessionSupervisor.AbortAsync(cancellationToken);
        OperationStatus = text.Get("Operation.StopRequested");
    }

    public async Task RespondToExtensionUiAsync(
        string requestId,
        IReadOnlyDictionary<string, object?> response,
        CancellationToken cancellationToken) =>
        await sessionSupervisor.RespondToExtensionUiAsync(requestId, response, cancellationToken);

    public async Task CloseSessionAsync(CancellationToken cancellationToken)
    {
        ThrowIfDisposed();
        await sessionLifecycleGate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            await CloseSessionCoreAsync(cancellationToken);
        }
        finally
        {
            sessionLifecycleGate.Release();
        }
    }

    public async Task SetApiKeyAsync(
        string providerId,
        string apiKey,
        CancellationToken cancellationToken)
    {
        if (controlBridge is null)
        {
            OperationStatus = text.Get("Operation.ControlUnavailable");
            return;
        }
        await controlBridge.SetApiKeyAsync(providerId, apiKey, cancellationToken);
        OperationStatus = text.Format("Operation.ApiKeySaved", providerId);
        await RefreshControlDataAsync(cancellationToken);
    }

    public async Task LogoutAsync(string providerId, CancellationToken cancellationToken)
    {
        if (controlBridge is null) return;
        await controlBridge.LogoutAsync(providerId, cancellationToken);
        OperationStatus = text.Format("Operation.LoggedOut", providerId);
        await RefreshControlDataAsync(cancellationToken);
    }

    public async Task RunOAuthAsync(
        string providerId,
        Func<OAuthProgress, CancellationToken, Task<string?>> interactionHandler,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(interactionHandler);
        if (controlBridge is null)
        {
            OperationStatus = text.Get("Operation.ControlUnavailable");
            return;
        }

        await foreach (OAuthProgress progress in controlBridge.BeginOAuthAsync(providerId, cancellationToken))
        {
            OperationStatus = progress.Message;
            if (progress.InteractionId is not null)
            {
                string? value = await interactionHandler(progress, cancellationToken);
                if (value is null || (!progress.AllowEmpty && string.IsNullOrWhiteSpace(value)))
                {
                    await controlBridge.CancelOAuthAsync(progress.FlowId, cancellationToken);
                    OperationStatus = text.Format("Operation.OAuthCancelled", providerId);
                    return;
                }
                await controlBridge.RespondToOAuthAsync(
                    progress.FlowId,
                    progress.InteractionId,
                    value,
                    cancellationToken);
            }
            else if (progress.AuthorizationUri is not null)
            {
                _ = await interactionHandler(progress, cancellationToken);
            }
        }
        OperationStatus = text.Format("Operation.OAuthComplete", providerId);
        await RefreshControlDataAsync(cancellationToken);
    }

    public async Task UpdateDefaultModelAsync(
        ModelListItemViewModel model,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (controlBridge is null) return;
        await controlBridge.UpdateDefaultsAsync(model.Provider, model.Id, cancellationToken);
        OperationStatus = text.Format("Operation.DefaultModelUpdated", model.QualifiedId);
        await RefreshControlDataAsync(cancellationToken);
    }

    public async Task RefreshModelsAsync(CancellationToken cancellationToken)
    {
        if (controlBridge is null) return;
        await controlBridge.RefreshModelsAsync(cancellationToken);
        await RefreshControlDataAsync(cancellationToken);
        OperationStatus = text.Get("Operation.ModelsRefreshed");
    }

    private async Task CloseSessionCoreAsync(CancellationToken cancellationToken)
    {
        sessionCancellation?.Cancel();
        if (IsSessionActive) await sessionSupervisor.CloseSessionAsync(cancellationToken);
        if (eventPump is not null)
        {
            try
            {
                await eventPump;
            }
            catch (OperationCanceledException)
            {
            }
        }
        sessionCancellation?.Dispose();
        sessionCancellation = null;
        eventPump = null;
        IsSessionActive = false;
        IsAgentRunning = false;
    }

    public ValueTask DisposeAsync()
    {
        lock (disposeGate)
        {
            disposeTask ??= DisposeCoreAsync();
            return new ValueTask(disposeTask);
        }
    }

    private async Task DisposeCoreAsync()
    {
        Interlocked.Exchange(ref disposed, 1);
        await sessionLifecycleGate.WaitAsync();
        try
        {
            await CloseSessionCoreAsync(CancellationToken.None);
            if (controlBridge is not null) await controlBridge.DisposeAsync();
            await sessionSupervisor.DisposeAsync();
        }
        finally
        {
            sessionLifecycleGate.Release();
        }
    }

    private async Task RefreshSessionsAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<PiSessionReference> sessions = await projectionStore.ListSessionsAsync(
            string.IsNullOrWhiteSpace(WorkspacePath) ? null : WorkspacePath,
            offset: 0,
            limit: 100,
            cancellationToken: cancellationToken);
        Sessions.Clear();
        foreach (PiSessionReference session in sessions)
        {
            Sessions.Add(new SessionListItemViewModel(
                session.DesktopThreadId,
                session.DisplayName ?? Path.GetFileNameWithoutExtension(session.SessionPath),
                session.SessionPath,
                session.LastOpenedAt));
        }
    }

    private async Task RefreshControlDataAsync(CancellationToken cancellationToken)
    {
        if (controlBridge is null) return;
        Task<IReadOnlyList<PiModelSummary>> modelsRequest = controlBridge.ListModelsAsync(cancellationToken);
        Task<IReadOnlyList<RedactedAuthStatus>> authRequest = controlBridge.GetAuthStatusAsync(cancellationToken);
        await Task.WhenAll(modelsRequest, authRequest);
        IReadOnlyList<PiModelSummary> models = await modelsRequest;
        IReadOnlyList<RedactedAuthStatus> auth = await authRequest;
        Models.Clear();
        foreach (PiModelSummary model in models)
        {
            Models.Add(new ModelListItemViewModel(model.Provider, model.Id, model.DisplayName, model.IsDefault));
        }
        ModelListItemViewModel? defaultModel = Models.FirstOrDefault(static model => model.IsDefault);
        DefaultModelStatus = defaultModel is null
            ? text.Get("Model.NotSelected")
            : text.Format("Model.Default", defaultModel.QualifiedId);
        AuthProviders.Clear();
        foreach (RedactedAuthStatus provider in auth)
        {
            AuthProviders.Add(new AuthListItemViewModel(
                provider.ProviderId,
                provider.Configured,
                provider.Configured ? provider.Source : text.Get("Auth.NotConfigured"),
                provider.AccountLabel,
                provider.SupportsApiKey,
                provider.SupportsOAuth));
        }
    }

    private async Task PumpEventsAsync(CancellationToken cancellationToken)
    {
        try
        {
            await foreach (PiRpcEvent rpcEvent in sessionSupervisor.ReadEventsAsync(cancellationToken))
            {
                switch (rpcEvent.Type)
                {
                    case "agent_start":
                        Post(() => IsAgentRunning = true);
                        break;
                    case "agent_settled":
                        Post(() =>
                        {
                            IsAgentRunning = false;
                            OperationStatus = text.Get("Operation.AgentComplete");
                        });
                        break;
                    case "message_update":
                        HandleMessageUpdate(rpcEvent.Payload, cancellationToken);
                        break;
                    case "message_end":
                        HandleMessageEnd(rpcEvent.Payload);
                        break;
                    case "tool_execution_start":
                        HandleToolStart(rpcEvent.Payload);
                        break;
                    case "tool_execution_end":
                        HandleToolEnd(rpcEvent.Payload);
                        break;
                    case "extension_ui_request":
                        HandleExtensionUiRequest(rpcEvent.Payload);
                        break;
                    case "extension_error":
                        Post(() => OperationStatus = text.Get("Operation.ExtensionError"));
                        break;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            Post(() => OperationStatus = text.Format("Operation.EventStreamStopped", Bound(exception.Message, 300)));
        }
        finally
        {
            Post(() => IsAgentRunning = false);
        }
    }

    private void HandleMessageUpdate(JsonElement payload, CancellationToken cancellationToken)
    {
        if (!payload.TryGetProperty("assistantMessageEvent", out JsonElement update)
            || GetOptionalString(update, "type") != "text_delta")
        {
            return;
        }
        string? delta = GetOptionalString(update, "delta");
        if (string.IsNullOrEmpty(delta)) return;
        int version;
        lock (streamingGate)
        {
            streamingText.Append(delta);
            version = streamVersion;
        }
        ScheduleStreamingFlush(version, cancellationToken);
    }

    private bool ProjectExistingEntries(JsonElement data)
    {
        if (!data.TryGetProperty("entries", out JsonElement entries)
            || entries.ValueKind is not JsonValueKind.Array)
        {
            return false;
        }

        Transcript.Clear();
        Queue<TranscriptItemViewModel> projected = new(MaximumTranscriptItems);
        int projectedCount = 0;
        foreach (JsonElement entry in entries.EnumerateArray())
        {
            if (GetOptionalString(entry, "type") != "message"
                || !entry.TryGetProperty("message", out JsonElement message))
            {
                continue;
            }
            string role = GetOptionalString(message, "role") ?? "Pi";
            JsonElement envelope = JsonSerializer.SerializeToElement(new { message });
            string messageText = ExtractMessageText(envelope);
            if (!string.IsNullOrWhiteSpace(messageText))
            {
                projectedCount++;
                if (projected.Count == MaximumTranscriptItems) _ = projected.Dequeue();
                projected.Enqueue(new TranscriptItemViewModel(
                    role == "user" ? text.Get("Transcript.User") : text.Get("Transcript.Pi"),
                    messageText,
                    isStreaming: false));
            }
        }
        foreach (TranscriptItemViewModel item in projected) Transcript.Add(item);
        return projectedCount > MaximumTranscriptItems;
    }

    private void HandleMessageEnd(JsonElement payload)
    {
        string finalMessage = ExtractMessageText(payload);
        Post(() =>
        {
            string buffered;
            lock (streamingGate)
            {
                buffered = streamingText.ToString();
                streamingText.Clear();
                lastFlushedLength = 0;
                streamVersion++;
            }
            string finalText = string.IsNullOrWhiteSpace(finalMessage) ? buffered : finalMessage;
            if (streamingItem is null)
            {
                if (!string.IsNullOrWhiteSpace(finalText))
                {
                    AppendTranscript(new TranscriptItemViewModel(text.Get("Transcript.Pi"), finalText, isStreaming: false));
                }
            }
            else
            {
                streamingItem.Markdown = finalText;
                streamingItem.IsStreaming = false;
                streamingItem = null;
            }
        });
    }

    private void ScheduleStreamingFlush(int version, CancellationToken cancellationToken)
    {
        if (Interlocked.Exchange(ref flushScheduled, 1) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(50), cancellationToken);
                string snapshot;
                lock (streamingGate)
                {
                    if (version != streamVersion) return;
                    snapshot = streamingText.ToString();
                    lastFlushedLength = snapshot.Length;
                }
                Post(() =>
                {
                    streamingItem ??= new TranscriptItemViewModel(text.Get("Transcript.Pi"), string.Empty, isStreaming: true);
                    if (!Transcript.Contains(streamingItem)) AppendTranscript(streamingItem);
                    streamingItem.Markdown = snapshot;
                });
            }
            catch (OperationCanceledException)
            {
            }
            finally
            {
                Interlocked.Exchange(ref flushScheduled, 0);
                lock (streamingGate)
                {
                    if (version == streamVersion && streamingText.Length > lastFlushedLength)
                    {
                        ScheduleStreamingFlush(version, cancellationToken);
                    }
                }
            }
        }, CancellationToken.None);
    }

    private void HandleToolStart(JsonElement payload)
    {
        string id = GetOptionalString(payload, "toolCallId") ?? Guid.NewGuid().ToString("N");
        string name = GetOptionalString(payload, "toolName") ?? "tool";
        string detail = payload.TryGetProperty("args", out JsonElement args)
            ? CreateSafeToolSummary(args)
            : text.Get("Tool.ParametersHidden");
        Post(() =>
        {
            ToolActivities.Insert(0, new ToolActivityViewModel(id, name, detail, text.Get("Tool.Running")));
            while (ToolActivities.Count > MaximumToolActivities) ToolActivities.RemoveAt(ToolActivities.Count - 1);
        });
    }

    private void HandleToolEnd(JsonElement payload)
    {
        string? id = GetOptionalString(payload, "toolCallId");
        if (id is null) return;
        bool isError = payload.TryGetProperty("isError", out JsonElement error) && error.ValueKind is JsonValueKind.True;
        Post(() =>
        {
            ToolActivityViewModel? item = ToolActivities.FirstOrDefault(activity => activity.Id == id);
            if (item is not null) item.Status = isError ? text.Get("Tool.Failed") : text.Get("Tool.Complete");
        });
    }

    private void HandleExtensionUiRequest(JsonElement payload)
    {
        string id = GetOptionalString(payload, "id") ?? string.Empty;
        string method = GetOptionalString(payload, "method") ?? string.Empty;
        if (method == "notify")
        {
            Post(() => OperationStatus = GetOptionalString(payload, "message") ?? text.Get("Operation.ExtensionNotice"));
            return;
        }
        if (method == "setTitle")
        {
            string title = GetOptionalString(payload, "title") ?? "Pi-67 Desktop";
            Post(() => TitleRequested?.Invoke(this, new TitleRequestedEventArgs(title)));
            return;
        }
        if (method == "set_editor_text")
        {
            Post(() => ComposerText = GetOptionalString(payload, "text") ?? string.Empty);
            return;
        }
        if (method is "setStatus" or "setWidget")
        {
            Post(() => OperationStatus = GetOptionalString(payload, "statusText")
                ?? GetStringArray(payload, "widgetLines").FirstOrDefault()
                ?? OperationStatus);
            return;
        }

        TimeSpan? timeout = payload.TryGetProperty("timeout", out JsonElement timeoutElement)
            && timeoutElement.TryGetInt32(out int timeoutMilliseconds)
            ? TimeSpan.FromMilliseconds(timeoutMilliseconds)
            : null;
        ExtensionUiRequest request = new(
            id,
            method,
            GetOptionalString(payload, "title") ?? text.Get("Extension.RequestTitle"),
            GetOptionalString(payload, "message"),
            GetOptionalString(payload, "placeholder"),
            GetOptionalString(payload, "prefill"),
            GetStringArray(payload, "options"),
            timeout);
        Post(() => ExtensionUiRequested?.Invoke(this, new ExtensionUiRequestEventArgs(request)));
    }

    private void ApplyTrustStatus(ProjectTrustStatus trust)
    {
        TrustDecision = trust.State switch
        {
            ProjectTrustState.TrustedPersistently => ProjectTrustDecision.TrustAndPersist,
            ProjectTrustState.TrustedForProcess => ProjectTrustDecision.TrustOnce,
            _ => ProjectTrustDecision.Deny,
        };
        TrustStatus = trust.State switch
        {
            ProjectTrustState.TrustedPersistently => text.Get("Trust.Persisted"),
            ProjectTrustState.TrustedForProcess => text.Get("Trust.Process"),
            ProjectTrustState.Denied => text.Get("Trust.Denied"),
            _ => trust.TrustRequiringResources.Count > 0
                ? text.Get("Trust.RequiresResources")
                : text.Get("Trust.NoResources"),
        };
    }

    private void ReplaceBootstrapStep(BootstrapStep update)
    {
        int index = -1;
        for (int candidate = 0; candidate < BootstrapSteps.Count; candidate++)
        {
            if (BootstrapSteps[candidate].Id == update.Id)
            {
                index = candidate;
                break;
            }
        }
        if (index < 0)
        {
            BootstrapSteps.Add(update);
            return;
        }

        BootstrapStep existing = BootstrapSteps[index];
        BootstrapSteps[index] = existing with
        {
            Status = update.Status,
            FailureCode = update.FailureCode,
            FailureMessage = update.FailureMessage,
        };
    }

    private BootstrapStep LocalizeBootstrapStep(BootstrapStep step)
    {
        string nameKey = $"Bootstrap.{step.Id}.Name";
        string descriptionKey = $"Bootstrap.{step.Id}.Description";
        string localizedName = text.Get(nameKey);
        string localizedDescription = text.Get(descriptionKey);
        return step with
        {
            DisplayName = localizedName == nameKey ? step.DisplayName : localizedName,
            Description = localizedDescription == descriptionKey ? step.Description : localizedDescription,
        };
    }

    private void AppendTranscript(TranscriptItemViewModel item)
    {
        while (Transcript.Count >= MaximumTranscriptItems) Transcript.RemoveAt(0);
        Transcript.Add(item);
    }

    private void RestoreComposer(
        string message,
        IReadOnlyList<ComposerAttachmentViewModel> attachments,
        TranscriptItemViewModel transcriptItem)
    {
        ComposerText = message;
        Transcript.Remove(transcriptItem);
        foreach (ComposerAttachmentViewModel attachment in attachments)
        {
            Attachments.Add(attachment);
        }
    }

    private string CreateSafeToolSummary(JsonElement arguments)
    {
        if (arguments.ValueKind is not JsonValueKind.Object) return text.Get("Tool.ParametersHidden");
        string[] pathKeys = ["path", "filePath", "file_path", "cwd", "workdir"];
        List<string> parts = [];
        foreach (string key in pathKeys)
        {
            string? value = GetOptionalString(arguments, key);
            if (!string.IsNullOrWhiteSpace(value)) parts.Add($"{key}: {Bound(value, 260)}");
        }
        return parts.Count == 0 ? text.Get("Tool.SensitiveHidden") : string.Join(" · ", parts);
    }

    private void Post(Action action) => uiContext.Post(static state => ((Action)state!).Invoke(), action);

    private static string ExtractMessageText(JsonElement payload)
    {
        if (!payload.TryGetProperty("message", out JsonElement message)
            || !message.TryGetProperty("content", out JsonElement content))
        {
            return string.Empty;
        }
        if (content.ValueKind is JsonValueKind.String) return content.GetString() ?? string.Empty;
        if (content.ValueKind is not JsonValueKind.Array) return string.Empty;
        return string.Join(
            "\n",
            content.EnumerateArray()
                .Where(static block => GetOptionalString(block, "type") == "text")
                .Select(static block => GetOptionalString(block, "text"))
                .Where(static text => !string.IsNullOrEmpty(text)));
    }

    private static string? GetOptionalString(JsonElement element, string name) =>
        element.ValueKind is JsonValueKind.Object
        && element.TryGetProperty(name, out JsonElement property)
        && property.ValueKind is JsonValueKind.String
            ? property.GetString()
            : null;

    private static string[] GetStringArray(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement property)
        && property.ValueKind is JsonValueKind.Array
            ? property.EnumerateArray()
                .Where(static value => value.ValueKind is JsonValueKind.String)
                .Select(static value => value.GetString()!)
                .ToArray()
            : [];

    private static string Bound(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : $"{value[..maximumLength]}...";

    private void ThrowIfDisposed() =>
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
}
