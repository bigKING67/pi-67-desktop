import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("theme controller", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts supported preferences and rejects stale storage values", async () => {
    const { parseThemePreference } = await import("./theme-controller.js");

    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("midnight")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("resolves system preference without overriding explicit choices", async () => {
    const { resolveTheme } = await import("./theme-controller.js");

    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("initializes once from persistent storage and applies the effective theme", async () => {
    const fixture = installBrowserFixture({ storedPreference: "dark", systemDark: false });
    const { initializeThemeController } = await import("./theme-controller.js");

    expect(initializeThemeController()).toEqual({
      preference: "dark",
      effective: "dark",
      persistence: "persistent"
    });
    expect(initializeThemeController()).toEqual({
      preference: "dark",
      effective: "dark",
      persistence: "persistent"
    });
    expect(fixture.dataset).toEqual({ theme: "dark", themePreference: "dark" });
    expect(fixture.addEventListener).toHaveBeenCalledOnce();
  });

  it("persists explicit choices, removes the system override, and follows later OS changes", async () => {
    const fixture = installBrowserFixture({ storedPreference: null, systemDark: false });
    const { initializeThemeController, setThemePreference } = await import("./theme-controller.js");
    initializeThemeController();

    setThemePreference("dark");
    expect(fixture.storage.setItem).toHaveBeenCalledWith("pi67.themePreference", "dark");
    expect(fixture.dataset).toMatchObject({ theme: "dark", themePreference: "dark" });

    fixture.emitSystemTheme(false);
    expect(fixture.dataset.theme).toBe("dark");

    setThemePreference("system");
    expect(fixture.storage.removeItem).toHaveBeenCalledWith("pi67.themePreference");
    expect(fixture.dataset).toMatchObject({ theme: "light", themePreference: "system" });

    fixture.emitSystemTheme(true);
    expect(fixture.dataset).toMatchObject({ theme: "dark", themePreference: "system" });
  });

  it("falls back to memory when localStorage cannot be read", async () => {
    const fixture = installBrowserFixture({ storageReadError: true, systemDark: true });
    const { initializeThemeController, setThemePreference } = await import("./theme-controller.js");

    expect(initializeThemeController()).toEqual({
      preference: "system",
      effective: "dark",
      persistence: "memory"
    });
    setThemePreference("light");
    expect(fixture.dataset).toMatchObject({ theme: "light", themePreference: "light" });
    expect(fixture.storage.setItem).not.toHaveBeenCalled();
  });

  it("stops retrying a storage backend after a persistence failure", async () => {
    const fixture = installBrowserFixture({ persistError: true, storedPreference: null, systemDark: false });
    const { initializeThemeController, setThemePreference } = await import("./theme-controller.js");
    initializeThemeController();

    setThemePreference("dark");
    expect(fixture.storage.setItem).toHaveBeenCalledOnce();
    expect(fixture.dataset).toMatchObject({ theme: "dark", themePreference: "dark" });

    setThemePreference("light");
    expect(fixture.storage.setItem).toHaveBeenCalledOnce();
    expect(fixture.dataset).toMatchObject({ theme: "light", themePreference: "light" });
  });
});

function installBrowserFixture(options: {
  storedPreference?: string | null;
  systemDark: boolean;
  storageReadError?: boolean;
  persistError?: boolean;
}) {
  let systemThemeListener: ((event: MediaQueryListEvent) => void) | undefined;
  const addEventListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
    systemThemeListener = listener as (event: MediaQueryListEvent) => void;
  });
  const mediaQuery = {
    matches: options.systemDark,
    addEventListener,
    removeEventListener: vi.fn()
  } as unknown as MediaQueryList;
  const storage = {
    getItem: vi.fn(() => options.storedPreference ?? null),
    setItem: vi.fn(() => {
      if (options.persistError) throw new Error("storage quota exceeded");
    }),
    removeItem: vi.fn(() => {
      if (options.persistError) throw new Error("storage quota exceeded");
    })
  } as unknown as Storage;
  const windowValue = {
    matchMedia: vi.fn(() => mediaQuery)
  } as unknown as Window & typeof globalThis;
  Object.defineProperty(windowValue, "localStorage", {
    configurable: true,
    get() {
      if (options.storageReadError) throw new Error("storage denied");
      return storage;
    }
  });
  const dataset: Record<string, string> = {};
  vi.stubGlobal("window", windowValue);
  vi.stubGlobal("document", { documentElement: { dataset } });
  return {
    addEventListener,
    dataset,
    storage: storage as Storage & {
      getItem: ReturnType<typeof vi.fn>;
      setItem: ReturnType<typeof vi.fn>;
      removeItem: ReturnType<typeof vi.fn>;
    },
    emitSystemTheme(matches: boolean) {
      if (!systemThemeListener) throw new Error("Theme listener was not installed.");
      systemThemeListener({ matches } as MediaQueryListEvent);
    }
  };
}
