import { isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { publishNotification } from "../notifications/notification-store.js";
import { removeRendererWorkspace } from "../workbench/workspace-registration-controller.js";
import { WorkspaceRemovalDialog } from "./WorkspaceRemovalDialog.js";
let retained = true;
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: () => [false, vi.fn()] }));
vi.mock("../notifications/notification-store.js", () => ({ publishNotification: vi.fn() }));
vi.mock("../workbench/workspace-registration-controller.js", () => ({ removeRendererWorkspace: vi.fn() }));
vi.mock("../workbench/workbench-store.js", () => ({ rendererWorkbenchStore: { getState: () => ({ workspaces: retained ? { fixture: {} } : {} }) } }));
it.each(["retained", "removed", "compensation"] as const)("reports the actual %s removal outcome", async (outcome) => {
  vi.clearAllMocks();
  retained = outcome !== "removed";
  vi.mocked(removeRendererWorkspace).mockRejectedValue(outcome === "compensation"
    ? new AggregateError([new Error("remove"), new Error("register")], "compensation failed") : new Error("remove failed"));
  const onDismiss = vi.fn();
  const tree = WorkspaceRemovalDialog({ workspace: { id: "fixture", displayName: "fixture", identity: { canonicalPath: "/fixture", assurance: "path-only" }, trust: "unknown", trustProvenance: "indirect", availability: "available" }, onDismiss });
  const press = removalPress(tree);
  expect(press).toBeDefined();
  press!();
  await vi.waitFor(() => expect(publishNotification).toHaveBeenCalledOnce());
  expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
    title: retained ? "无法完成工作区移除" : "工作区已移除，后续清理未完成",
    message: expect.stringContaining(outcome === "compensation" ? "注册未能恢复" : retained ? "仍显示" : "登记已移除")
  }));
  expect(onDismiss).toHaveBeenCalledTimes(retained ? 0 : 1);
});
function removalPress(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const result = removalPress(child); if (result) return result; }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode; onPress?: () => void }>(node)) return undefined;
  return node.props.children === "仅从工作台移除" ? node.props.onPress : removalPress(node.props.children);
}
