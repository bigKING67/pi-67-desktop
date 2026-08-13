import { ProtocolRequestError } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  observeAgentHostFailure,
  observeAgentHostStartup,
  resetAgentHostStartupStateForTest,
  shouldSuppressAgentHostFollowup
} from "./agent-host-startup-state.js";

describe("renderer Agent Host startup state", () => {
  beforeEach(() => {
    resetAgentHostStartupStateForTest();
    useNotificationStore.getState().clear();
  });

  it("publishes one bounded notification for a degraded Host epoch", () => {
    const state = {
      hostEpoch: 7,
      startup: {
        profileMode: "existing-shared" as const,
        status: "degraded" as const,
        issues: [{ stage: "browser67-mcp" as const, code: "conflict" as const }]
      }
    };

    observeAgentHostStartup(state);
    observeAgentHostStartup(state);

    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(useNotificationStore.getState().items[0]).toMatchObject({
      level: "warning",
      title: "已保留现有 Pi 配置"
    });
  });

  it("suppresses only connection follow-ups after a deterministic startup failure", () => {
    expect(observeAgentHostFailure({
      hostEpoch: 8,
      code: 1,
      recoverable: false,
      startupFailure: {
        type: "agent-host-startup-failed",
        profileMode: "existing-shared",
        issue: { stage: "server-construction", code: "unknown" }
      }
    })).toBe(true);

    expect(shouldSuppressAgentHostFollowup(new ProtocolRequestError({
      code: "CONNECTION_CLOSED",
      message: "Pi runtime unavailable",
      recoverable: true
    }))).toBe(true);
    expect(shouldSuppressAgentHostFollowup(new Error("Provider configuration is invalid."))).toBe(false);

    observeAgentHostStartup({
      hostEpoch: 9,
      startup: { profileMode: "existing-shared", status: "ready", issues: [] }
    });
    expect(shouldSuppressAgentHostFollowup(new ProtocolRequestError({
      code: "CONNECTION_CLOSED",
      message: "Pi runtime unavailable",
      recoverable: true
    }))).toBe(false);
  });
});
