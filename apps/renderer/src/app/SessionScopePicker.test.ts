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

it("renders no origin line without a projection and keeps a legacy snapshot unverified", () => {
  expect(renderToStaticMarkup(createElement(SessionMemoryOrigin))).toBe("");
  const identity = identityProjectionFromSnapshot({ cwd: "/workspace" } as SessionSnapshot);
  expect(identity.memoryOrigin).toEqual({ kind: "unverified" });
});

it("shows team origin without claiming current access", () => {
  const memoryOrigin = { kind: "team", teamId: "team", projectId: "project" };
  useSessionProjectionStore.setState({ identity: identityProjectionFromSnapshot({ cwd: "/workspace", memoryOrigin } as SessionSnapshot) });
  const markup = renderToStaticMarkup(createElement(SessionMemoryOriginLabel, { origin: useSessionProjectionStore.getState().identity?.memoryOrigin }));
  expect(markup).toContain("团队会话 · team / project · 继续处理仍需当前权限");
});

it.each(["private", "unverified"] as const)("keeps the quiet default for %s origin", (kind) => {
  expect(renderToStaticMarkup(createElement(SessionMemoryOriginLabel, { origin: { kind } }))).toBe("");
});

it.each([false, true])("shows explicit draft scope and preserves the separate-draft contract: %s", (team) => {
  const task = { id: "task", ...(team ? { teamScope: { teamId: "team", projectId: "project" } } : {}) } as RendererWorkbenchTask;
  const markup = renderToStaticMarkup(createElement(SessionScopePicker, { task }));
  expect(markup).toContain("对话归属");
  expect(markup).not.toContain("设为工作区默认</button>");
  expect(markup).toContain(team ? "team / project" : "私人");
  expect(markup).toContain('aria-expanded="false"');
});

it("disables selection once creation has started", () => {
  const task = { id: "task", creationStatus: "pending" } as RendererWorkbenchTask;
  expect(renderToStaticMarkup(createElement(SessionScopePicker, { task }))).toContain('disabled=""');
});
