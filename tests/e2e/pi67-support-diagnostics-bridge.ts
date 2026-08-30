import type { Page } from "@playwright/test";
import type {
  DesktopSystemBridge,
  SupportDiagnosticsExportRequest,
  SupportDiagnosticsUploadReceipt
} from "@pi67/protocol";

export type MockSupportDiagnosticsBridge = Pick<DesktopSystemBridge, "uploadDiagnostics">;

export async function installMockSupportDiagnosticsBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixtureWindow = window as unknown as {
      __pi67SystemFixture?: { methods: Partial<DesktopSystemBridge> };
    };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    const receipt: SupportDiagnosticsUploadReceipt = {
      schema: "pi67-support-receipt.v1",
      reportId: "PI67-A1B2C3D4E5F6",
      receivedAt: Date.UTC(2026, 7, 29, 6, 0, 0),
      sizeBytes: 4_096,
      sha256: "0".repeat(64),
      objectKey: "diagnostics/2026/08/29/PI67-A1B2C3D4E5F6.json"
    };
    let finishPendingUpload: (() => void) | undefined;
    const control = {
      attempts: 0,
      mode: "success" as "success" | "failure" | "pending",
      requests: [] as SupportDiagnosticsExportRequest[],
      setMode(mode: "success" | "failure" | "pending") {
        this.mode = mode;
      },
      finishPending() {
        finishPendingUpload?.();
        finishPendingUpload = undefined;
      }
    };
    const bridge: MockSupportDiagnosticsBridge = {
      uploadDiagnostics: async (request) => {
        control.attempts += 1;
        control.requests.push(structuredClone(request));
        if (control.mode === "failure") {
          throw new Error("诊断上传服务暂时不可用，请稍后重试或导出到本地。");
        }
        if (control.mode === "pending") {
          await new Promise<void>((resolve) => {
            finishPendingUpload = resolve;
          });
        }
        return structuredClone(receipt);
      }
    };
    Object.assign(systemFixture.methods, bridge);
    Object.defineProperty(window, "__pi67SupportDiagnosticsTest", {
      configurable: false,
      value: control
    });
  });
}
