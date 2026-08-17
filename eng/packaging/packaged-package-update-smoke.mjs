const PACKAGE_UPDATE_CHECK_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 50;

export async function verifyPackagedExtensionUpdateCheck(workspace, window) {
  return verifyPackagedUpdateCheck({
    button: workspace.getByRole("button", {
      name: /^(?:检查更新|检查中…|更新可用 \d+)$/u
    }).first(),
    idleLabel: "检查更新",
    surface: workspace,
    window
  });
}

export async function verifyPackagedSkillUpdateCheck(workspace, window) {
  return verifyPackagedUpdateCheck({
    button: workspace.getByRole("button", {
      name: /^(?:检查技能更新|检查中…|更新可用 \d+)$/u
    }).first(),
    idleLabel: "检查技能更新",
    surface: workspace,
    window
  });
}

async function verifyPackagedUpdateCheck({ button, idleLabel, surface, window }) {
  const checkedAtBefore = await surface.getAttribute("data-package-update-checked-at");
  const pageErrors = [];
  const capturePageError = (error) => {
    if (pageErrors.length < 4) pageErrors.push(error.message.slice(0, 1_000));
  };
  window.on("pageerror", capturePageError);
  try {
    await button.waitFor({ state: "visible", timeout: PACKAGE_UPDATE_CHECK_TIMEOUT_MS });
    await button.click();
    const deadline = Date.now() + PACKAGE_UPDATE_CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await surface.evaluateAll((elements) => {
        const element = elements[0];
        return element ? {
          checkedAt: element.getAttribute("data-package-update-checked-at"),
          phase: element.getAttribute("data-package-update-check")
        } : undefined;
      });
      if (!state) {
        throw new Error(`Packaged ${idleLabel} removed its Settings surface: ${JSON.stringify({
          pageErrors,
          surface: await inspectUpdateCheckSurface(window)
        })}`);
      }
      if (state.phase === "failed") break;
      if (state.phase === "completed" || (state.checkedAt !== null && state.checkedAt !== checkedAtBefore)) {
        await assertNoUpdateCheckError(surface, window, idleLabel);
        return { status: (await button.innerText()).trim() };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    await assertNoUpdateCheckError(surface, window, idleLabel);
    throw new Error(`Packaged ${idleLabel} did not finish within ${PACKAGE_UPDATE_CHECK_TIMEOUT_MS}ms.`);
  } finally {
    window.off("pageerror", capturePageError);
  }
}

async function assertNoUpdateCheckError(surface, window, label) {
  const inlineErrors = await surface.getByRole("alert").allTextContents();
  const errorToasts = await window.getByLabel("通知").getByRole("alert").allTextContents();
  if (inlineErrors.length > 0 || errorToasts.length > 0) {
    throw new Error(`Packaged ${label} reported an error: ${JSON.stringify({
      errorToasts: errorToasts.slice(0, 4),
      inlineErrors: inlineErrors.slice(0, 4)
    })}`);
  }
}

function inspectUpdateCheckSurface(window) {
  return window.evaluate(() => ({
    bodyText: document.body.innerText.slice(0, 2_000),
    rootChildCount: document.querySelector("#root")?.childElementCount ?? 0,
    selectedSettings: [...document.querySelectorAll('[aria-current="page"]')]
      .slice(0, 4)
      .map((element) => element.textContent?.trim() ?? ""),
    settingsVisible: Boolean(document.querySelector('[data-testid="settings-workbench"]')),
    title: document.title,
    url: location.href
  }));
}
