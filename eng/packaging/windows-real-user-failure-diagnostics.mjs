const ALLOWLISTED_ACKNOWLEDGEMENT_TIMEOUT_COMMANDS = new Set([
  "operation.abort",
  "prompt.submit",
  "provider.configuration.get",
  "provider.list",
  "session.catalog.query",
  "session.create",
  "workspace.register"
]);

export async function inspectRealUserRuntimeSurface(window, privateRoot) {
  const observation = await window.evaluate((allowlistedCommands) => {
    const bodyText = document.body.innerText;
    const acknowledgementTimeoutMatch = /Agent request acknowledgement timed out:\s*([a-z][a-z0-9]*(?:\.[a-zA-Z0-9]+)+)/u
      .exec(bodyText);
    const acknowledgementTimeoutCommand = acknowledgementTimeoutMatch?.[1];
    const runtimeStatus = document.querySelector('[aria-label^="当前状态："]');
    const workspaceGroup = document.querySelector('[data-testid="workspace-group"]');
    const errorNotifications = document.querySelectorAll('[aria-label="通知"] [role="alert"]');
    return {
      acknowledgementTimedOut: bodyText.includes("Agent request acknowledgement timed out"),
      acknowledgementTimeoutCommand:
        acknowledgementTimeoutCommand
        && allowlistedCommands.includes(acknowledgementTimeoutCommand)
          ? acknowledgementTimeoutCommand
          : null,
      catalogError: workspaceGroup?.getAttribute("data-catalog-error") ?? null,
      catalogLoading: workspaceGroup?.getAttribute("data-catalog-loading") ?? null,
      errorNotificationCount: errorNotifications.length,
      providerConfigurationFailed: bodyText.includes("无法读取 Pi Provider 配置"),
      runtimePhase: runtimeStatus?.getAttribute("data-runtime-phase") ?? null,
      runtimeStatus: runtimeStatus?.getAttribute("aria-label")?.slice(0, 160) ?? null,
      workspaceOpenFailed: bodyText.includes("无法打开工作区")
    };
  }, [...ALLOWLISTED_ACKNOWLEDGEMENT_TIMEOUT_COMMANDS]);
  const sanitize = (value) => typeof value === "string"
    ? value.replaceAll(privateRoot, "<temporary-root>")
    : value;
  return {
    ...observation,
    catalogError: sanitize(observation.catalogError),
    catalogLoading: sanitize(observation.catalogLoading),
    runtimeStatus: sanitize(observation.runtimeStatus)
  };
}

export function realUserLifecycleFailureKind(error) {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.includes("raw acknowledgement timeout")) return "raw-acknowledgement-timeout";
  if (error.message.includes("failure notification")) return "failure-notification";
  if (error.name === "TimeoutError" || /timed? out|timeout/iu.test(error.message)) return "bounded-timeout";
  return "lifecycle-error";
}
