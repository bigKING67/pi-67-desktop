import { runNativeMcpPrompt } from "./controlled-provider-interaction.mjs";
import {
  assertPackagedNativeMcpCall,
  assertPackagedNativeMcpProcessesStopped,
  resetPackagedNativeMcpProcessReceipt
} from "./packaged-native-mcp-smoke.mjs";

export async function runPackagedNativeMcpScenario(window, nativeMcp) {
  await runNativeMcpPrompt(window);
  const receipt = await assertPackagedNativeMcpCall(nativeMcp);
  console.info("Packaged native MCP smoke passed: tool=" + receipt.tool
    + ", calls=" + receipt.calls + ", servers=" + receipt.servers + ".");
}

export async function completePackagedNativeMcpShutdown(nativeMcp, resetForRestart = false) {
  await assertPackagedNativeMcpProcessesStopped(nativeMcp.processReceiptPath);
  if (resetForRestart) await resetPackagedNativeMcpProcessReceipt(nativeMcp.processReceiptPath);
}
