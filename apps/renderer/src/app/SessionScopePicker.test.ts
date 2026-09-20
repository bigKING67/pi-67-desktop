import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it } from "vitest";
import { SessionScopePicker } from "./SessionScopePicker.js";
import { SessionMemoryOrigin, SessionMemoryOriginLabel } from "../transcript/SessionMemoryOrigin.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { identityProjectionFromSnapshot } from "../session/session-projection-snapshot.js";
import type { SessionSnapshot } from "@pi67/domain";

beforeEach(() => useSessionProjectionStore.setState({ identity: undefined }));

it("does not infer private origin from missing projection or a legacy snapshot", () => {
  expect(renderToStaticMarkup(createElement(SessionMemoryOrigin))).toContain("会话来源未验证");
  const identity = identityProjectionFromSnapshot({ cwd: "/workspace" } as SessionSnapshot);
  expect(identity.memoryOrigin).toEqual({ kind: "unverified" });
});

it.each(["private", "team"] as const)("shows %s origin without claiming current access", (kind) => {
  const memoryOrigin = kind === "team" ? { kind, teamId: "team", projectId: "project" } : { kind };
  useSessionProjectionStore.setState({ identity: identityProjectionFromSnapshot({ cwd: "/workspace", memoryOrigin } as SessionSnapshot) });
  const markup = renderToStaticMarkup(createElement(SessionMemoryOriginLabel, { origin: useSessionProjectionStore.getState().identity?.memoryOrigin }));
  expect(markup).toContain(kind === "team" ? "继续处理仍需当前权限" : "私人会话");
});

it.each([false, true])("shows explicit draft scope and preserves the separate-draft contract: %s", (team) => {
  const task = { id: "task", ...(team ? { teamScope: { teamId: "team", projectId: "project" } } : {}) } as RendererWorkbenchTask;
  const markup = renderToStaticMarkup(createElement(SessionScopePicker, { task }));
  expect(markup).toContain("会话范围");
  expect(markup).toContain("更换范围会另开草稿，原内容保留");
  expect(markup).toContain(team ? "团队草稿" : "私人草稿");
  expect(markup.includes("另开私人草稿")).toBe(team);
});

it("disables selection once creation has started", () => {
  const task = { id: "task", creationStatus: "pending" } as RendererWorkbenchTask;
  expect(renderToStaticMarkup(createElement(SessionScopePicker, { task }))).toContain('disabled=""');
});
