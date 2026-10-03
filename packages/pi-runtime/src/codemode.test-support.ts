import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionInteractionMode, TaskToolMode, ToolExecutionView, WorkspaceTrust } from "@pi67/domain";
import { callNativeTool, createNativeMcpFixture } from "./native-mcp.test-support.js";
import { ToolExecutionProjector } from "./tool-execution-projector.js";
import { createDesktopCodemodeExtension } from "./codemode-extension.js";
import { TOOL_EXECUTION_RECEIPT_TYPE } from "./tool-execution-receipt.js";

type CodemodeFixture = Awaited<ReturnType<typeof createNativeMcpFixture>> & {
  events: AgentSessionEvent[];
  projections: ToolExecutionView[];
  run: (code: string) => ReturnType<typeof callNativeTool>;
};

export async function createCodemodeFixture(options: {
  mode?: TaskToolMode;
  interaction?: SessionInteractionMode;
  trust?: WorkspaceTrust;
  exposure?: "direct" | "deferred";
  excludeTools?: string[];
} = {}): Promise<CodemodeFixture> {
  const fixture = await createNativeMcpFixture({
    persistSession: true,
    safety: { taskToolMode: options.mode ?? "auto", interactionMode: options.interaction ?? "execute", trust: options.trust ?? "trusted" },
    ...(options.exposure ? { exposure: options.exposure } : {}),
    ...(options.excludeTools ? { excludeTools: options.excludeTools } : {}),
    additionalExtensions: [createDesktopCodemodeExtension()]
  });
  const events: AgentSessionEvent[] = [];
  const projections: ToolExecutionView[] = [];
  const projector = new ToolExecutionProjector({
    emit: (execution) => projections.push(execution),
    getCwd: () => fixture.root,
    persistReceipt: (data) => fixture.session.sessionManager.appendCustomEntry(TOOL_EXECUTION_RECEIPT_TYPE, data),
    reportReceiptFailure: () => { throw new Error("Codemode receipt persistence failed"); }
  });
  const unsubscribe = fixture.session.subscribe((event) => {
    events.push(event);
    projector.handle(event);
  });
  return { ...fixture, events, projections,
    run: (code: string) => callNativeTool(fixture.session, "codemode", { code }),
    async close() {
      try { await fixture.close(); } finally { unsubscribe(); projector.reset(); }
    }
  };
}

export function resultText(result: { content: unknown } | undefined): string {
  return JSON.stringify(result?.content) ?? "";
}
