import { readFile } from "node:fs/promises";
import type { Message } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { AUTO_MODEL_ID, AUTO_MODEL_PROVIDER, bindDesktopAutoRouting } from "./auto-routing.js";
import { AUTO_ROUTING_ENTRY } from "./auto-routing-evidence.js";
import { createAutoRoutingFixture } from "./auto-routing.test-support.js";

describe("Desktop Auto routing with the native Pi SDK", () => {
  it("forks only the chosen branch's routing evidence and physical model without judging on restore", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "standard" });
    try {
      await fixture.session.prompt("Make a small edit");
      const firstLeaf = fixture.manager.getLeafId();
      fixture.setJudgeReply("complex");
      await fixture.session.prompt("Design a cross-process protocol");
      const originalPath = fixture.manager.getSessionFile()!;
      const original = await readFile(originalPath, "utf8");
      const fork = SessionManager.open(originalPath);
      const forkPath = fork.createBranchedSession(firstLeaf!);
      expect(forkPath).not.toBe(originalPath);
      const { session } = await createAgentSessionFromServices({ services: fixture.services, sessionManager: fork });
      try {
        await bindDesktopAutoRouting(session);
        expect(session.model).toMatchObject({ provider: AUTO_MODEL_PROVIDER, id: AUTO_MODEL_ID });
        expect(session.routedModel?.model.id).toBe("standard");
        expect(fork.getBranch().filter((entry) => entry.type === "custom" && entry.customType === AUTO_ROUTING_ENTRY))
          .toEqual([expect.objectContaining({ data: expect.objectContaining({ selected: { provider: "fixture", model: "standard" } }) })]);
        expect(fixture.providerCalls.filter((call) => call.kind === "judge")).toHaveLength(2);
        await session.prompt("Start a new complex task on this branch");
        expect(session.routedModel?.model.id).toBe("complex");
        expect(fixture.providerCalls.filter((call) => call.kind === "judge")).toHaveLength(3);
        expect(await readFile(originalPath, "utf8")).toBe(original);
      } finally { session.dispose(); }
    } finally { await fixture.dispose(); }
  });

  it("classifies once, dispatches a physical candidate, records native usage/evidence, and restores Auto without judging", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "complex" });
    try {
      await fixture.session.prompt("Refactor a cross-process recovery boundary");
      expect(fixture.session.agent.state.errorMessage).toBeUndefined();
      expect(fixture.providerCalls).toEqual([
        { kind: "judge", model: "judge" },
        { kind: "candidate", model: "complex" }
      ]);
      expect(fixture.session.model).toMatchObject({ provider: AUTO_MODEL_PROVIDER, id: AUTO_MODEL_ID });
      expect(fixture.session.routedModel?.model).toMatchObject({ provider: "fixture", id: "complex" });
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "custom", customType: AUTO_ROUTING_ENTRY, data: expect.objectContaining({
          status: "selected", reason: "complex", selected: { provider: "fixture", model: "complex" }
        })
      }));
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "usage", kind: "auto-routing", provider: "fixture", model: "judge"
      }));

      const file = fixture.manager.getSessionFile();
      expect(file).toBeDefined();
      expect(await readFile(file!, "utf8")).toContain(AUTO_ROUTING_ENTRY);
      const reopened = SessionManager.open(file!);
      const { session } = await createAgentSessionFromServices({
        services: fixture.services,
        sessionManager: reopened
      });
      await bindDesktopAutoRouting(session);
      expect(session.model).toMatchObject({ provider: AUTO_MODEL_PROVIDER, id: AUTO_MODEL_ID });
      session.dispose();
      expect(fixture.providerCalls.filter((call) => call.kind === "judge")).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps the selected physical candidate for tool continuations", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "standard", candidateReplies: ["tool", "stop"] });
    try {
      await fixture.session.prompt("Apply a small local edit");
      expect(fixture.providerCalls).toEqual([
        { kind: "judge", model: "judge" },
        { kind: "candidate", model: "standard" },
        { kind: "candidate", model: "standard" }
      ]);
      expect(fixture.manager.getEntries().filter((entry) => (
        entry.type === "custom" && entry.customType === AUTO_ROUTING_ENTRY
      ))).toHaveLength(1);
    } finally {
      await fixture.dispose();
    }
  });

  it("uses the fixed classifier bounds and makes a fresh decision for a distinct task", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "standard" });
    try {
      await fixture.session.prompt("x".repeat(20_000));
      expect(fixture.judgeRequests).toEqual([{ model: "judge", maxTokens: 128, temperature: 0, text: "x".repeat(16_000) }]);

      fixture.setJudgeReply("complex");
      await fixture.session.prompt("Design a cross-process recovery protocol");
      expect(fixture.providerCalls.filter(call => call.kind === "judge")).toEqual([
        { kind: "judge", model: "judge" }, { kind: "judge", model: "judge" }
      ]);
      expect(fixture.providerCalls.filter(call => call.kind === "candidate")).toEqual([
        { kind: "candidate", model: "standard" }, { kind: "candidate", model: "complex" }
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  it("holds one routing decision for steering, continuation, and retry without another judge", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "standard" });
    try {
      const auto = fixture.runtime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID);
      if (!auto) throw new Error("Expected Auto model.");
      const signal = new AbortController().signal;
      const messages: Message[] = [{ role: "user", content: "Apply a small edit", timestamp: Date.now() }];
      fixture.session.agent.state.messages = messages;
      const first = await fixture.runtime.resolveModel(auto, messages, { reason: "user", thinkingLevel: "off", signal });
      fixture.setJudgeReply("complex");
      const steered = await fixture.runtime.resolveModel(auto, [{ role: "user", content: "Add this while it runs", timestamp: Date.now() }], {
        reason: "user", thinkingLevel: "off", signal
      });
      const continued = await fixture.runtime.resolveModel(auto, messages, {
        reason: "continuation", thinkingLevel: "off", state: first.state
      });
      const retried = await fixture.runtime.resolveModel(auto, messages, {
        reason: "retry", thinkingLevel: "off", state: first.state
      });
      expect([first, steered, continued, retried].map(route => route.model.id)).toEqual(["standard", "standard", "standard", "standard"]);
      expect(fixture.providerCalls).toEqual([{ kind: "judge", model: "judge" }]);
    } finally {
      await fixture.dispose();
    }
  });

  it("selects the other candidate for an image when the classified one lacks image input", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "standard", imageStandard: false, imageComplex: true });
    try {
      await fixture.session.prompt("Read this screenshot", {
        images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5swAAAABJRU5ErkJggg==" }]
      });
      expect(fixture.providerCalls).toEqual([
        { kind: "judge", model: "judge" },
        { kind: "candidate", model: "complex" }
      ]);
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "custom", customType: AUTO_ROUTING_ENTRY,
        data: expect.objectContaining({ status: "selected", reason: "image-capability" })
      }));
    } finally {
      await fixture.dispose();
    }
  });

  it.each(["invalid", "error"] as const)("never calls a candidate after a %s judge outcome", async (judgeReply) => {
    const fixture = await createAutoRoutingFixture({ judgeReply });
    try {
      await fixture.session.prompt("Classify this task");
      expect(fixture.providerCalls.filter((call) => call.kind === "candidate")).toEqual([]);
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "custom", customType: AUTO_ROUTING_ENTRY,
        data: expect.objectContaining({ status: "failed", reason: judgeReply === "invalid" ? "invalid-decision" : "judge-failed" })
      }));
    } finally {
      await fixture.dispose();
    }
  });

  it("times out or cancels a pending judge without calling a candidate", async () => {
    vi.useFakeTimers();
    const fixture = await createAutoRoutingFixture({ judgeReply: "pending" });
    try {
      const pending = fixture.session.prompt("Wait for classification");
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      expect(fixture.providerCalls.filter((call) => call.kind === "candidate")).toEqual([]);
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "custom", customType: AUTO_ROUTING_ENTRY,
        data: expect.objectContaining({ status: "failed", reason: "timed-out" })
      }));
    } finally {
      vi.useRealTimers();
      await fixture.dispose();
    }
  });

  it("cancels a pending judge without calling a candidate", async () => {
    const fixture = await createAutoRoutingFixture({ judgeReply: "pending" });
    try {
      const auto = fixture.runtime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID);
      if (!auto) throw new Error("Expected Auto model.");
      const controller = new AbortController();
      fixture.session.agent.state.messages = [{ role: "user", content: "Cancel classification", timestamp: Date.now() }];
      const pending = fixture.runtime.resolveModel(auto, [{ role: "user", content: "Cancel classification", timestamp: Date.now() }], {
        reason: "user", thinkingLevel: "off", signal: controller.signal
      });
      await vi.waitFor(() => expect(fixture.providerCalls).toEqual([{ kind: "judge", model: "judge" }]));
      controller.abort();
      await expect(pending).rejects.toThrow("AUTO_JUDGE_CANCELLED");
      expect(fixture.providerCalls.filter(call => call.kind === "candidate")).toEqual([]);
      expect(fixture.manager.getEntries()).toContainEqual(expect.objectContaining({
        type: "custom", customType: AUTO_ROUTING_ENTRY,
        data: expect.objectContaining({ status: "failed", reason: "cancelled" })
      }));
    } finally {
      await fixture.dispose();
    }
  });
});
