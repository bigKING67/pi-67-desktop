import { createHash } from "node:crypto";
import {
  validateNativePowerResumeEvidence,
  validateTrustedImeSubmissionEvidence
} from "./windows-native-interaction-evidence.mjs";
import {
  startControlledPrompt
} from "./controlled-provider-interaction.mjs";

const IME_EXPECTED_VALUE = "测试";
const IME_TIMEOUT_MS = 120_000;
const SLEEP_TIMEOUT_MS = 15 * 60_000;

export async function installNativeCertificationProtocolProbe(page) {
  await page.evaluate((expectedImeValue) => {
    globalThis.__pi67NativeCertificationProbe = {
      activeOperationId: undefined,
      ime: undefined
    };
    window.addEventListener("message", (event) => {
      const data = event.data;
      const port = event.ports[0];
      if (
        event.source !== window
        || data?.source !== "pi67-preload"
        || data?.type !== "agent-port"
        || !port
      ) return;
      const initialPromptRequests = new Set();
      const imeRequests = new Set();
      port.addEventListener("message", (messageEvent) => {
        const envelope = messageEvent.data;
        const probe = globalThis.__pi67NativeCertificationProbe;
        if (!probe) return;
        if (
          envelope?.kind === "request"
          && envelope.type === "prompt.submit"
          && probe.ime?.armed !== true
          && probe.activeOperationId === undefined
        ) {
          initialPromptRequests.add(envelope.requestId);
          return;
        }
        if (
          envelope?.kind === "response"
          && envelope.type === "prompt.submit"
          && initialPromptRequests.has(envelope.requestId)
          && envelope.ok === true
          && envelope.result?.kind === "accepted"
          && typeof envelope.result.operationId === "string"
        ) {
          probe.activeOperationId = envelope.result.operationId;
          return;
        }
        if (
          envelope?.kind === "request"
          && envelope.type === "prompt.submit"
          && probe.ime?.armed === true
        ) {
          imeRequests.add(envelope.requestId);
          probe.ime.requestCount += 1;
          probe.ime.textMatches &&= envelope.payload?.text === expectedImeValue;
          probe.ime.delivery = probe.ime.delivery === undefined
            ? envelope.payload?.delivery
            : probe.ime.delivery === envelope.payload?.delivery ? probe.ime.delivery : "multiple";
          return;
        }
        if (
          envelope?.kind === "response"
          && envelope.type === "prompt.submit"
          && imeRequests.has(envelope.requestId)
        ) {
          probe.ime.responseCount += 1;
          if (
            envelope.ok === true
            && envelope.result?.kind === "accepted"
            && typeof envelope.result.operationId === "string"
          ) {
            probe.ime.acceptedCount += 1;
            probe.ime.operationIdMatches &&= envelope.result.operationId === probe.activeOperationId;
          }
        }
      });
      port.start();
    });
  }, IME_EXPECTED_VALUE);
}

export async function startControlledOperation(page) {
  await startControlledPrompt(page);
  await page.waitForFunction(
    () => typeof globalThis.__pi67NativeCertificationProbe?.activeOperationId === "string",
    undefined,
    { timeout: 10_000 }
  );
}

export async function certifyMicrosoftPinyin(page, application, terminal) {
  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("");
  await composer.evaluate((element) => {
    globalThis.__pi67TrustedImeEvents = [];
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (globalThis.__pi67TrustedImeEvents.length >= 16) return;
      globalThis.__pi67TrustedImeEvents.push({
        isComposing: event.isComposing,
        isTrusted: event.isTrusted,
        keyCode: event.keyCode
      });
    }, { capture: true });
  });
  await terminal.question(
    "切换到 Microsoft Pinyin。按 Enter 后应用会获得焦点；请输入 ceshi，并用 Enter 确认候选“测试”。准备好后按 Enter："
  );
  await focusApplication(application);
  await composer.click();
  await waitForStableComposerValue(composer, IME_EXPECTED_VALUE);
  const events = await composer.evaluate(() => globalThis.__pi67TrustedImeEvents ?? []);
  const confirmation = events.find((event) => (
    event.isTrusted && (event.isComposing || event.keyCode === 229)
  ));
  if (!confirmation) {
    throw new Error("No trusted Microsoft Pinyin Enter event reached the Composer IME guard.");
  }
  const eventsBeforeSecondEnter = events.length;
  await page.evaluate(() => {
    const probe = globalThis.__pi67NativeCertificationProbe;
    if (!probe?.activeOperationId) throw new Error("Native certification protocol probe is unavailable.");
    probe.ime = {
      acceptedCount: 0,
      armed: true,
      delivery: undefined,
      operationIdMatches: true,
      requestCount: 0,
      responseCount: 0,
      textMatches: true
    };
  });
  await terminal.question(
    "候选“测试”已确认。按 Enter 将焦点交回应用，然后在 Composer 内再按一次 Enter 发送："
  );
  await focusApplication(application);
  await composer.click();
  await page.waitForFunction(
    () => globalThis.__pi67NativeCertificationProbe?.ime?.acceptedCount === 1,
    undefined,
    { timeout: IME_TIMEOUT_MS }
  );
  await waitForStableComposerValue(composer, "");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  const finalEvents = await composer.evaluate(() => globalThis.__pi67TrustedImeEvents ?? []);
  const probe = await page.evaluate(() => globalThis.__pi67NativeCertificationProbe);
  const submission = validateTrustedImeSubmissionEvidence({
    composerValue: await composer.inputValue(),
    events: finalEvents,
    eventsBeforeSecondEnter,
    probe: probe?.ime === undefined ? undefined : {
      ...probe.ime,
      activeOperationId: probe.activeOperationId
    }
  });
  return {
    expectedValue: IME_EXPECTED_VALUE,
    acceptedTextSha256: createHash("sha256").update(IME_EXPECTED_VALUE).digest("hex"),
    ...submission
  };
}

export async function certifySleepResume(page, application, terminal) {
  const markerStartedAt = await installNativePowerProbe(application);
  await terminal.question(
    "按 Enter 后认证器开始等待。请让 Windows 真实进入睡眠，再唤醒并登录回当前桌面会话："
  );
  await focusApplication(application);
  await page.getByLabel("当前状态：系统恢复后 Pi 状态已重新同步")
    .waitFor({ state: "visible", timeout: SLEEP_TIMEOUT_MS });
  const events = await waitForNativePowerEvents(application, markerStartedAt);
  await page.locator('[data-agent-connected="true"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("button", { name: "停止" }).waitFor({ state: "visible", timeout: 30_000 });
  return validateNativePowerResumeEvidence({
    events,
    markerStartedAt,
    operationStillActive: true,
    projectionRecovered: true
  });
}

async function installNativePowerProbe(application) {
  return application.evaluate(({ powerMonitor }) => {
    const markerStartedAt = Date.now();
    const events = [];
    globalThis.__pi67NativePowerProbe = { markerStartedAt, events };
    powerMonitor.on("suspend", () => {
      if (events.length < 16) events.push({ type: "suspend", at: Date.now() });
    });
    powerMonitor.on("resume", () => {
      if (events.length < 16) events.push({ type: "resume", at: Date.now() });
    });
    return markerStartedAt;
  });
}

async function waitForNativePowerEvents(application, markerStartedAt) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const probe = await application.evaluate(() => globalThis.__pi67NativePowerProbe);
    if (probe?.markerStartedAt === markerStartedAt
      && probe.events.some((event) => event.type === "resume")) return probe.events;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Windows powerMonitor did not emit resume after the certification marker.");
}

async function focusApplication(application) {
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
  });
}

async function waitForStableComposerValue(composer, expectedValue) {
  const deadline = Date.now() + IME_TIMEOUT_MS;
  let stableSince;
  while (Date.now() < deadline) {
    const value = await composer.inputValue();
    if (value === expectedValue) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 1_500) return;
    } else {
      stableSince = undefined;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Microsoft Pinyin candidate confirmation did not preserve “${expectedValue}” in the Composer.`);
}
