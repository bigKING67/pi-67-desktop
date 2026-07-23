import type { Page } from "@playwright/test";

interface FixtureMessage {
  id: string;
  role: string;
  parts: Array<{ type: string; text: string }>;
}

export async function installMockDesktopBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "0.1.0-alpha.1" }),
          connectAgentHost: async () => undefined,
          selectWorkspace: async () => "/Users/test/Projects/pi-demo",
          selectSessionFile: async () => "/Users/test/.pi/agent/sessions/demo.jsonl",
          saveDiagnostics: async () => "/tmp/pi67-diagnostics.json",
          showNotification: async () => undefined,
          requestOpenExternal: async (url: string) => {
            const testWindow = window as unknown as {
              __pi67UpdateTest: { checks: number; openedUrls: string[]; allowOpen: boolean };
            };
            testWindow.__pi67UpdateTest.openedUrls.push(url);
            return testWindow.__pi67UpdateTest.allowOpen;
          },
          getUpdateState: async () => ({
            phase: "idle",
            channel: "unsigned-preview",
            currentVersion: "0.1.0-alpha.1"
          }),
          checkForUpdates: async () => {
            const testWindow = window as unknown as { __pi67UpdateTest: { checks: number } };
            testWindow.__pi67UpdateTest.checks += 1;
            return {
              phase: "available",
              channel: "unsigned-preview",
              currentVersion: "0.1.0-alpha.1",
              version: "0.1.0-alpha.2",
              releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
              publishedAt: "2026-07-23T06:00:00.000Z"
            };
          },
          onAgentHostFailed: () => () => undefined
        }
      }
    });
    Object.defineProperty(window, "__pi67UpdateTest", {
      configurable: false,
      value: { checks: 0, openedUrls: [], allowOpen: false }
    });
  });
}

export async function attachMockAgent(
  page: Page,
  messages: FixtureMessage[] = [],
  responseDelays: Record<string, number> = {}
): Promise<void> {
  await page.evaluate(({ fixtureMessages, fixtureResponseDelays }) => {
    let snapshot = {
      sessionId: "session-test",
      sessionPath: "/Users/test/.pi/agent/sessions/demo.jsonl",
      cwd: "/Users/test/Projects/pi-demo",
      streaming: false,
      messages: fixtureMessages,
      models: [
        { provider: "openai", id: "gpt-test", label: "GPT Test", configured: true, reasoning: true },
        { provider: "anthropic", id: "claude-test", label: "Claude Test", configured: false, reasoning: true }
      ],
      providers: [
        { id: "openai", label: "OpenAI", configured: true, credentialSource: "stored", modelCount: 1 },
        { id: "anthropic", label: "Anthropic", configured: false, modelCount: 1 }
      ],
      selectedModel: { provider: "openai", id: "gpt-test" },
      thinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium", "high"],
      steeringQueue: [],
      followUpQueue: [],
      tree: [],
      resources: [{ kind: "skill", id: "design-craft", label: "design-craft", status: "ready" }],
      stats: { tokens: 0, cost: 0, contextPercent: 0 }
    };
    const channel = new MessageChannel();
    channel.port2.onmessage = (event) => {
      const envelope = event.data as { requestId?: string; command?: { type?: string; payload?: { provider?: string } } };
      if (!envelope.requestId) return;
      const testWindow = window as unknown as { __pi67TestCommands?: string[] };
      testWindow.__pi67TestCommands ??= [];
      if (envelope.command?.type) testWindow.__pi67TestCommands.push(envelope.command.type);
      const doctorReport = {
        generatedAt: Date.now(),
        checks: [
          { id: "platform", label: "Platform", status: "pass", detail: "darwin/arm64" },
          { id: "node", label: "Embedded Node", status: "pass", detail: "24.18.0" },
          { id: "pi-sdk", label: "Pi SDK", status: "pass", detail: "0.81.1" },
          { id: "shell", label: "Pi shell", status: "pass", detail: "/bin/bash - GNU bash" },
          { id: "git", label: "Git", status: "pass", detail: "git version 2.50.0" }
        ]
      };
      if (envelope.command?.type === "model.setRuntimeKey" && envelope.command.payload?.provider) {
        const providerId = envelope.command.payload.provider;
        snapshot = {
          ...snapshot,
          models: snapshot.models.map((model) => model.provider === providerId ? { ...model, configured: true } : model),
          providers: snapshot.providers.map((provider) => provider.id === providerId
            ? { ...provider, configured: true, credentialSource: "runtime" }
            : provider)
        };
      }
      const data = envelope.command?.type === "session.list" || envelope.command?.type === "command.list"
        ? []
        : envelope.command?.type === "doctor.run"
          ? doctorReport
          : snapshot;
      const respond = () => channel.port2.postMessage({
        protocolVersion: 1,
        kind: "response",
        messageId: `mock-${Date.now()}`,
        requestId: envelope.requestId,
        timestamp: Date.now(),
        response: { ok: true, data }
      });
      const delay = fixtureResponseDelays[envelope.command?.type ?? ""] ?? 0;
      if (delay > 0) setTimeout(respond, delay);
      else respond();
    };
    channel.port2.start();
    Object.defineProperty(window, "__pi67TestAgentPort", { configurable: true, value: channel.port2 });
    window.postMessage({ source: "pi67-preload", type: "agent-port" }, "*", [channel.port1]);
  }, { fixtureMessages: messages, fixtureResponseDelays: responseDelays });
}

export async function clearRecordedCommands(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __pi67TestCommands?: string[] }).__pi67TestCommands = [];
  });
}

export async function recordedCommands(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { __pi67TestCommands?: string[] }).__pi67TestCommands ?? [])
  ]);
}

export async function emitMockAgentEvent(page: Page, event: unknown): Promise<void> {
  await page.evaluate((agentEvent) => {
    const port = (window as unknown as { __pi67TestAgentPort: MessagePort }).__pi67TestAgentPort;
    port.postMessage({
      protocolVersion: 1,
      kind: "event",
      messageId: `mock-event-${Date.now()}`,
      sequence: Date.now(),
      timestamp: Date.now(),
      event: agentEvent
    });
  }, event);
}
