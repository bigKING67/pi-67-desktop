export const WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX = 1_320;
const WINDOWS_NAVIGATION_DRAWER_BREAKPOINT_PX = 760;

export async function observeLayout(window) {
  return window.evaluate((breakpoints) => {
    const rect = (element) => element ? rectangle(element.getBoundingClientRect()) : null;
    const composer = document.querySelector('[data-testid="composer-shell"]');
    const contextDrawer = document.querySelector(".context-pane");
    const contextDrawerScrim = document.querySelector(".context-drawer-scrim");
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
      contextDrawerMode: contextDrawerScrim !== null && getComputedStyle(contextDrawerScrim).display !== "none",
      contextDrawerVisible: contextDrawer !== null && getComputedStyle(contextDrawer).display !== "none",
      devicePixelRatio: window.devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      matchesContextBreakpoint: window.matchMedia(`(max-width: ${breakpoints.context}px)`).matches,
      matchesNavigationBreakpoint: window.matchMedia(`(max-width: ${breakpoints.navigation}px)`).matches,
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
      const topmostElement = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
      const topmost = topmostElement === element || (topmostElement !== null && element.contains(topmostElement));
      return {
        contained: value.left >= 0 && value.top >= 0 && value.right <= width && value.bottom <= height,
        rect: rectangle(value),
        topmost,
        topmostSurface: topmost
          ? "control"
          : classifyForegroundSurface(topmostElement)
      };
    }

    function classifyForegroundSurface(element) {
      if (!element) return "none";
      if (element.closest(".context-pane, .context-drawer-scrim")) return "context-drawer";
      if (element.closest('.navigation-rail, [aria-label="关闭对话导航"]')) return "navigation-drawer";
      return "other";
    }
  }, {
    context: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
    navigation: WINDOWS_NAVIGATION_DRAWER_BREAKPOINT_PX
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
    throw new Error(`${prefix}: max-width ${WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX}px media query did not match.`);
  }
  if (contract.breakpoint === "navigation-drawer" && !observation.matchesNavigationBreakpoint) {
    throw new Error(`${prefix}: max-width ${WINDOWS_NAVIGATION_DRAWER_BREAKPOINT_PX}px media query did not match.`);
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
    if (contract.expectedControlLayer) {
      if (control.topmostSurface !== contract.expectedControlLayer) {
        throw new Error(
          `${prefix}: ${name} expected ${contract.expectedControlLayer} foreground, got ${control.topmostSurface}.`
        );
      }
    } else if (!control.topmost) {
      throw new Error(`${prefix}: ${name} is covered by ${control.topmostSurface}.`);
    }
  }
  if (observation.titleBarNativeControlReserve < 136) {
    throw new Error(
      `${prefix}: title actions reserve only ${observation.titleBarNativeControlReserve}px for native Windows controls.`
    );
  }
}

export function assertContextPanelActivation(observation, requestedScaleFactor) {
  const mode = observation.matchesContextBreakpoint ? "drawer" : "docked-after-expansion";
  assertLayoutObservation(observation, {
    breakpoint: mode === "drawer" ? "context-drawer" : "context-expanded",
    ...(mode === "drawer" ? { expectedControlLayer: "context-drawer" } : {}),
    expectedWidth: observation.innerWidth,
    requestedScaleFactor
  });
  if (!observation.contextDrawerVisible) {
    throw new Error(`Scale ${requestedScaleFactor}: context panel is not visible after activation.`);
  }
  if (mode === "drawer" && !observation.contextDrawerMode) {
    throw new Error(`Scale ${requestedScaleFactor}: constrained context activation did not use the drawer.`);
  }
  if (mode === "docked-after-expansion") {
    if (observation.innerWidth <= WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX) {
      throw new Error(`Scale ${requestedScaleFactor}: context activation did not expand beyond the drawer breakpoint.`);
    }
    if (observation.contextDrawerMode) {
      throw new Error(`Scale ${requestedScaleFactor}: expanded context activation retained the drawer scrim.`);
    }
  }
  return mode;
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
