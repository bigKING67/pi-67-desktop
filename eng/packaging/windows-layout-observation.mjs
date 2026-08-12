export async function observeLayout(window) {
  return window.evaluate(() => {
    const rect = (element) => element ? rectangle(element.getBoundingClientRect()) : null;
    const composer = document.querySelector('[data-testid="composer-shell"]');
    const contextDrawer = document.querySelector(".context-pane");
    const navigationDrawer = document.querySelector(".navigation-rail");
    const send = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "发送");
    const stop = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "停止");
    const titleBar = document.querySelector(".title-bar");
    const titleActions = document.querySelector(".title-actions");
    const actionControls = titleActions
      ? [...titleActions.querySelectorAll("button, [role='button']")]
      : [];
    const rightmostActionControl = actionControls.reduce((right, element) => (
      Math.max(right, element.getBoundingClientRect().right)
    ), 0);
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    return {
      composer: rect(composer),
      contextDrawerVisible: contextDrawer !== null && getComputedStyle(contextDrawer).display !== "none",
      devicePixelRatio: window.devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      matchesContextBreakpoint: window.matchMedia("(max-width: 1040px)").matches,
      matchesNavigationBreakpoint: window.matchMedia("(max-width: 760px)").matches,
      navigationDrawerVisible: navigationDrawer !== null && getComputedStyle(navigationDrawer).display !== "none",
      outerWidth: window.outerWidth,
      send: controlObservation(send, viewportWidth, viewportHeight),
      stop: controlObservation(stop, viewportWidth, viewportHeight),
      titleBar: rect(titleBar),
      titleBarNativeControlReserve: window.innerWidth - rightmostActionControl,
      visualViewportHeight: viewportHeight,
      visualViewportWidth: viewportWidth
    };

    function rectangle(value) {
      return {
        bottom: value.bottom,
        height: value.height,
        left: value.left,
        right: value.right,
        top: value.top,
        width: value.width
      };
    }

    function controlObservation(element, width, height) {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
      return {
        contained: value.left >= 0 && value.top >= 0 && value.right <= width && value.bottom <= height,
        rect: rectangle(value),
        topmost: topmost === element || (topmost !== null && element.contains(topmost))
      };
    }
  });
}

export function assertLayoutObservation(observation, contract) {
  const prefix = `Scale ${contract.requestedScaleFactor} ${contract.breakpoint}`;
  if (Math.abs(observation.devicePixelRatio - contract.requestedScaleFactor) > 0.05) {
    throw new Error(`${prefix}: expected DPR ${contract.requestedScaleFactor}, got ${observation.devicePixelRatio}.`);
  }
  if (!viewportWidthMatches({
    allowNativeFrameFloor: contract.allowNativeFrameFloor === true,
    expectedWidth: contract.expectedWidth,
    innerWidth: observation.innerWidth,
    outerWidth: observation.outerWidth
  })) {
    throw new Error(
      `${prefix}: expected innerWidth ${contract.expectedWidth} or its native-frame floor, `
      + `got innerWidth ${observation.innerWidth} and outerWidth ${observation.outerWidth}.`
    );
  }
  if (contract.breakpoint === "context-drawer" && !observation.matchesContextBreakpoint) {
    throw new Error(`${prefix}: max-width 1040px media query did not match.`);
  }
  if (contract.breakpoint === "navigation-drawer" && !observation.matchesNavigationBreakpoint) {
    throw new Error(`${prefix}: max-width 760px media query did not match.`);
  }
  if (observation.horizontalOverflow > 1) {
    throw new Error(`${prefix}: document overflows horizontally by ${observation.horizontalOverflow}px.`);
  }
  if (!observation.composer || !observation.titleBar) {
    throw new Error(`${prefix}: Composer or TitleBar geometry is unavailable.`);
  }
  for (const [name, control] of [["Send", observation.send], ["Stop", observation.stop]]) {
    if (!control) throw new Error(`${prefix}: ${name} is unavailable.`);
    if (!control.contained) throw new Error(`${prefix}: ${name} is clipped.`);
    if (!control.topmost) throw new Error(`${prefix}: ${name} is covered.`);
  }
  if (observation.titleBarNativeControlReserve < 136) {
    throw new Error(
      `${prefix}: title actions reserve only ${observation.titleBarNativeControlReserve}px for native Windows controls.`
    );
  }
}

export function viewportWidthMatches({ allowNativeFrameFloor, expectedWidth, innerWidth, outerWidth }) {
  if (Math.abs(innerWidth - expectedWidth) <= 1) return true;
  if (!allowNativeFrameFloor || !Number.isFinite(outerWidth)) return false;

  // Windows can subtract its native resize frame from the 760px content probe.
  const nativeFrameWidth = Math.max(0, outerWidth - innerWidth);
  return innerWidth <= expectedWidth + 1
    && innerWidth >= expectedWidth - nativeFrameWidth - 1
    && outerWidth >= expectedWidth - 1;
}
