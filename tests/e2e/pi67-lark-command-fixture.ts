export type MockLarkCommandHandler = (
  type: string,
  payload: Record<string, unknown>
) => unknown;

export function installMockLarkCommandHandler(): void {
  const testWindow = window as Window & typeof globalThis & {
    __pi67ResolveMockLarkCommand?: MockLarkCommandHandler;
  };

  function applicationSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      cliStatus: "ready",
      phase: "disconnected",
      verified: false,
      checkedAt: Date.now(),
      appStatus: "ready",
      appId: "cli_test123",
      appBrand: "feishu",
      appName: "Pi-67 Test App",
      detail: "尚未获得有效的飞书用户授权。",
      ...overrides
    };
  }

  testWindow.__pi67ResolveMockLarkCommand = (type, payload) => {
    if (type === "lark.auth.status") return applicationSnapshot();
    if (type === "lark.auth.login.begin") {
      const now = Date.now();
      return {
        status: {
          ...applicationSnapshot(),
          phase: "authorizing",
          verified: false,
          checkedAt: now,
          detail: "授权页已打开；完成飞书确认后会自动更新连接状态。"
        },
        verificationUrl: "https://open.feishu.cn/device",
        userCode: "PI67-TEST",
        authorizationExpiresAt: now + 600_000
      };
    }
    if (type === "lark.app.configuration.save") return applicationSnapshot({
      appId: typeof payload.appId === "string" ? payload.appId : "cli_test123",
      appBrand: payload.brand === "lark" ? "lark" : "feishu"
    });
    return undefined;
  };
}
