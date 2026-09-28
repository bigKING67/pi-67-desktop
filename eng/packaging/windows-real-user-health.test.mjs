import { describe, expect, it, vi } from "vitest";
import { assertNoFailureNotifications, verifyGitMetadataIsHidden } from "./windows-real-user-health.mjs";

describe("Windows real-user workbench health", () => {
  it("restores a task inspector opened by the file projection probe", async () => {
    const fixture = healthFixture({ initiallyVisible: false });

    await expect(verifyGitMetadataIsHidden(fixture.window)).resolves.toEqual({
      gitMetadataHidden: true,
      readmeVisible: true
    });

    expect(fixture.show.click).toHaveBeenCalledOnce();
    expect(fixture.hide.click).toHaveBeenCalledOnce();
    expect(fixture.inspector.waitFor).toHaveBeenLastCalledWith({ state: "detached", timeout: 10_000 });
  });

  it("leaves an already-visible task inspector open", async () => {
    const fixture = healthFixture({ initiallyVisible: true });

    await verifyGitMetadataIsHidden(fixture.window);

    expect(fixture.show.click).not.toHaveBeenCalled();
    expect(fixture.hide.click).not.toHaveBeenCalled();
  });

  it("restores an inspector after a projection failure", async () => {
    const fixture = healthFixture({ initiallyVisible: false, rootNames: [".git", "README.md"] });

    await expect(verifyGitMetadataIsHidden(fixture.window)).rejects.toThrow(/exposed \.git metadata/u);

    expect(fixture.hide.click).toHaveBeenCalledOnce();
    expect(fixture.inspector.waitFor).toHaveBeenLastCalledWith({ state: "detached", timeout: 10_000 });
  });
});

function healthFixture({ initiallyVisible, rootNames = ["README.md"] }) {
  const show = { click: vi.fn() };
  const hide = { click: vi.fn() };
  const tab = { click: vi.fn() };
  const readme = { waitFor: vi.fn() };
  const fileNames = {
    allTextContents: vi.fn()
      .mockResolvedValueOnce(rootNames)
      .mockResolvedValueOnce([]),
    getByText: vi.fn(() => readme)
  };
  const search = { fill: vi.fn(), press: vi.fn() };
  const noMatches = { waitFor: vi.fn() };
  const inspector = {
    getByRole: vi.fn((role) => role === "tab" ? tab : search),
    getByText: vi.fn(() => noMatches),
    isVisible: vi.fn(async () => initiallyVisible),
    locator: vi.fn(() => fileNames),
    waitFor: vi.fn()
  };
  const window = {
    getByRole: vi.fn((role, options) => {
      if (role === "complementary") return inspector;
      if (options.name === "显示任务检查器") return show;
      if (options.name === "隐藏任务检查器") return hide;
      throw new Error(`Unexpected role lookup: ${role}/${String(options.name)}`);
    })
  };
  return { hide, inspector, show, window };
}

describe("Windows real-user failure notifications", () => {
  function notificationFixture({ providerErrorCount }) {
    const dialog = { waitFor: vi.fn(), textContent: vi.fn(async () => "") };
    const bell = { click: vi.fn() };
    return {
      window: {
        getByRole: vi.fn((role) => role === "dialog" ? dialog : bell),
        getByTestId: vi.fn(() => ({ count: vi.fn(async () => providerErrorCount) })),
        keyboard: { press: vi.fn() }
      }
    };
  }

  it("fails on the inline Provider configuration load error", async () => {
    const { window } = notificationFixture({ providerErrorCount: 1 });
    await expect(assertNoFailureNotifications(window)).rejects.toThrow(/Provider settings show a configuration load failure/u);
    expect(window.getByTestId).toHaveBeenCalledWith("provider-configuration-error");
  });

  it("passes when no Provider load error is rendered", async () => {
    const { window } = notificationFixture({ providerErrorCount: 0 });
    await expect(assertNoFailureNotifications(window)).resolves.toBeUndefined();
  });
});
