export const CONTROLLED_PROVIDER_TOOL_NAME = "pi67_long_turn_probe";

const APPROVAL_SCOPE_LABEL = "仅此 Tool Call";
const DENY_LABEL = "拒绝";
const ALLOW_LABEL = "仅允许本次";

export async function authorizeControlledProviderApproval({
  dialog,
  expectedCwd,
  protocol
}) {
  const visible = {
    toolName: await literalText(dialog, "tool-name"),
    target: await literalText(dialog, "target"),
    cwd: await literalText(dialog, "cwd"),
    scope: await dialog.getByText(APPROVAL_SCOPE_LABEL, { exact: true }).textContent()
  };
  const request = protocol?.approval;
  const expected = request
    && request.hostEpoch === protocol?.hostEpoch
    && request.operationId === protocol?.operationId
    && request.toolName === CONTROLLED_PROVIDER_TOOL_NAME
    && request.targetKind === "tool"
    && request.target === CONTROLLED_PROVIDER_TOOL_NAME
    && request.targetTruncated === false
    && request.cwd === expectedCwd
    && request.cwdTruncated === false
    && request.scope === "single-tool-call"
    && visible.toolName === CONTROLLED_PROVIDER_TOOL_NAME
    && visible.target === CONTROLLED_PROVIDER_TOOL_NAME
    && visible.cwd === expectedCwd
    && visible.scope === APPROVAL_SCOPE_LABEL;

  if (!expected) {
    await dialog.getByRole("button", { name: DENY_LABEL, exact: true }).click();
    throw new Error("Provider requested an unexpected Tool; certification failed closed.");
  }

  await dialog.getByRole("button", { name: ALLOW_LABEL, exact: true }).click();
  return {
    requestId: request.requestId,
    toolCallId: request.toolCallId,
    operationId: request.operationId
  };
}

async function literalText(dialog, kind) {
  return (await dialog.locator(`[data-security-literal="${kind}"]`).textContent())?.trim();
}
